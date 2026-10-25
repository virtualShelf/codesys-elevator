# codesys-elevator

5階建てのエレベータ1台を CODESYS（ST）で制御し、Modbus TCP 経由で TypeScript の画面から操作・監視するサンプル。

- 乗り場の「呼ぶ」ボタン、かご内の行き先ボタン、開・閉ボタン
- 扉が閉まってから移動し、着いたら扉を開ける（5秒で自動的に閉まる）
- 乗っている人数と重量を画面で設定。定格（600kg・9人）を超えると警報で、扉が閉まらない

PLC 側は `codesys/`、TypeScript 側は `web/` にまとめてある。Node 22.18 以上で `.ts` を直接実行する。依存ライブラリはないので `npm install` は不要。

ST の初心者向けの解説は [`docs/ST_GUIDE.md`](docs/ST_GUIDE.md)。

## 動かし方（まず CODESYS なしで）

コマンドはすべて `web` フォルダで実行する。

```bash
cd web
npm run sim    # ターミナル1：疑似PLC（ST と同じロジックを TypeScript で再現）
npm run ui     # ターミナル2：操作画面
```

ブラウザで **http://localhost:3001** を開く。

1. 3F の「呼ぶ」を押す → かごが 1F から上がってきて扉が開く
2. 「1人乗る」を何回か押す（扉が開いている間だけ操作できる）
3. かご内の「5」を押し、「閉」を押す → 5F へ移動
4. 合計重量を 700 などにする → 重量オーバーの警報。扉は閉まらない
5. 「全員降りる」→ 警報が消え、扉が閉まる

実機の CODESYS を使うときは、疑似PLC を止めてから CODESYS を Run する（どちらも 502 番を使うため）。

## CODESYS の設定

CODESYS プロジェクトは `codesys/Elevator.project`。ST の正本は同じ階層の `codesys/src/*.st`。

1. ST を取り込む：[codesys-st-sync](../codesys-st-sync) の画面版（`st-sync-ui.cmd`）で、
   プロジェクトファイルに `codesys\Elevator.project` を指定する（「ST フォルダ」には同じ階層の `codesys\src` が自動で入る）。そのままインポート（または各ファイルを貼り付け）
   - コマンド版なら、このリポジトリのルートで `..\codesys-st-sync\st-sync.cmd import "codesys\Elevator.project" "codesys\src"`
   - 列挙型 3つ（`E_ElevState` / `E_Direction` / `E_ElevCmd`）、GVL 2つ、ファンクション 2つ、FB 2つ、プログラム 1つ
2. タスク設定：`MainTask` に `PRG_Elevator` を追加する（周期は 10ms 程度）
3. Modbus：Ethernet の下の ModbusTCP Slave Device を
   - Input Registers：**20**、Holding Registers：**10** に設定
   - I/O マッピングで Input Registers → `GVL_ElevIO.aElevToTS`、Holding Registers → `GVL_ElevIO.aElevFromTS`
   - 「変数の更新」を「有効（常に更新）」に
4. ビルド → ログイン → ダウンロード → Run
5. `web` で `npm run ui` を実行して画面を開く（接続先は `MB_HOST` / `MB_PORT` で変更可）

## レジスタマップ

Holding Registers（TS → PLC）

| アドレス | 中身 |
|---|---|
| HR0 | 指令の種類（1: 行き先、2: 呼び、3: 開、4: 閉） |
| HR1 | 指令の対象階（1〜5） |
| HR2 | 指令の通し番号 |
| HR3 | 乗っている人数 [人] |
| HR4 | 積載重量 [kg] |

Input Registers（PLC → TS）

| アドレス | 中身 |
|---|---|
| IR0 | 状態（0: 停止、1: 扉開き中、2: 扉開、3: 扉閉じ中、4: 移動中、5: 重量オーバー） |
| IR1 | かごの位置 ×100（1.00F → 100） |
| IR2 | いちばん近い階 |
| IR3 | 方向（0: 停止、1: 上、2: 下） |
| IR4 | 扉の開き具合 [%] |
| IR5 | 行き先ボタンの点灯（bit0 = 1F） |
| IR6 | 乗り場の呼びの点灯（bit0 = 1F） |
| IR7 | PLC が受け取った人数 |
| IR8 | PLC が受け取った重量 [kg] |
| IR9 | フラグ（bit0 超過 / bit1 警報中 / bit2 扉全開 / bit3 扉全閉 / bit4 移動中） |
| IR10 | 処理済みの指令の通し番号 |
| IR11 | 定格積載量 [kg] |
| IR12 | 定員 [人] |
| IR13 | 階数 |
| IR14 | ハートビート |

## プログラムの構成

```
PRG_Elevator            Modbus のレジスタ ⇔ FB_Elevator の橋渡し（グローバル変数を触るのはここだけ）
 └ FB_Elevator          制御本体（呼びの受け付け、運転方向、扉、重量超過）
    ├ FB_Door           扉の開閉の動き（実機なら駆動装置とリミットスイッチ）
    ├ FC_NextCallFloor  進行方向の先にある、いちばん近い呼びを探す
    └ FC_FloorBit       階番号 → 呼びのビット
GVL_ElevParam           仕様（階数、定格、速さ、扉の時間）
GVL_ElevIO              Modbus のマッピング先
```

状態遷移（`E_ElevState`）:

```
Idle ──呼び（この階）──▶ DoorOpening ──全開──▶ DoorOpen ──5秒 or 閉──▶ DoorClosing ──全閉──▶ Idle
  │                          ▲                  │    ▲                    │
  └──呼び（他の階）──▶ Moving ─┘ 着いた           超過 │ 解消                  └─開・この階の呼び・超過──▶ DoorOpening
                                                ▼    │
                                               Overload
```

運転方向は「今の方向の呼びを順に片付けてから折り返す」。上昇中に途中の階で呼ばれたらそこで止まり、通り過ぎた階の呼びは折り返してから応える。

## 指令の送り方（取りこぼし対策）

画面からの指令（ボタン）は「種類・対象階・通し番号」の3つを **1回の書き込み（FC16）** で送る。

- PLC は通し番号が前回と変わったサイクルだけ、新しい指令として扱う
- 同じボタンを2回押しても、番号が変わるので取りこぼさない
- 画面のサーバーは、PLC が受け付けた番号（IR10）を確かめてから次の指令を送る。連打しても、PLC の1サイクルの間に指令が上書きされて消えることがない

人数と重量は「今の値」なので、通し番号なしでそのまま書く。

## テスト

```bash
cd web
npm test
```

疑似PLC のロジック（`web/src/logic.ts`）を、呼び出し・行き先・自動で閉まる扉・重量と人数の超過・駆け込み・途中階での停止・折り返し・範囲外の階の10シナリオで確認する。

`logic.ts` は ST と同じ動きを TypeScript で書き直したもの。ST を変えたら `logic.ts` も同じように直し、テストを通すこと。

## ファイル

| ファイル | 役割 |
|---|---|
| `codesys/Elevator.project` | CODESYS プロジェクト |
| `codesys/src/*.st` | CODESYS に入れる ST（正本） |
| `web/package.json` | npm のスクリプト（sim / ui / test） |
| `web/src/config.ts` | レジスタマップ、状態・指令の番号 |
| `web/src/logic.ts` | ST と同じロジック（疑似PLC 用） |
| `web/src/sim.ts` | 疑似PLC（Modbus TCP サーバー） |
| `web/src/server.ts` | 操作画面のサーバー（SSE 配信、指令・乗客の API） |
| `web/src/modbus.ts` | Modbus TCP クライアント |
| `web/src/modbusServer.ts` | 疑似PLC 用の Modbus TCP サーバー（FC03/04/06/16） |
| `web/public/` | 操作画面 |
| `web/tests/elevator_logic.test.ts` | ロジックのシナリオテスト |
| `web/DESIGN.md` | 画面のデザインシステム（Obsidian Precision） |
| `docs/ST_GUIDE.md` | ST の解説（初心者向け） |

## AI の利用について

このリポジトリのコード・テスト・ドキュメントは、AI と対話しながら作成しました。

| 用途 | ツール | モデル |
|---|---|---|
| 設計の相談、コード・ドキュメントの作成、レビュー | Claude（claude.ai のチャット） | Claude Opus 5.5 |
| PC での編集、テストの実行、ファイルの整理 | Claude Code | Claude Opus 5.5 |

動作は、ロジックのシナリオテスト（`npm test`）、ブラウザでの画面操作の自動テスト、本物の CODESYS（CODESYS Control Win）との Modbus TCP 接続で確認しています。

AI が書いた内容は作者が読んで確かめ、採用するかどうかを判断しています。
