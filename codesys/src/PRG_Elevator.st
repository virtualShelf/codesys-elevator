(* ==========================================================================
   PRG_Elevator
   目的 : Modbus のレジスタ（GVL_ElevIO）と FB_Elevator の橋渡し
          グローバル変数を触るのはこのプログラムだけにする
   入力 : GVL_ElevIO.aElevFromTS[0..4]  指令（種類・階・通し番号）、人数、重量
   出力 : GVL_ElevIO.aElevToTS[0..14]   状態、位置、扉、呼び、警報、定格値など
          （各レジスタの意味は README.md のレジスタマップ表を参照）
   指令 : 画面は「種類・階・通し番号」を1回の書き込み（FC16）で送る。
          通し番号が前回と変わったサイクルだけ、新しい指令として扱う
          （同じ階のボタンを2回押しても取りこぼさないため）
   使い方 : MainTask から毎サイクル呼ぶ
   履歴 : 2026-10-19  初版
   ========================================================================== *)
PROGRAM PRG_Elevator
VAR CONSTANT
    MAX_DELTA      : TIME := T#100MS;   (* 停止明けなどで経過時間が飛んだときの上限 *)
    POSITION_SCALE : REAL := 100.0;     (* 位置 [階] を INT に詰める倍率（1.00F → 100） *)
    MAX_INPUT      : INT  := 9999;      (* 人数・重量として受け付ける上限 *)
END_VAR
VAR
    fbElevator  : FB_Elevator;
    eCmdIn      : E_ElevCmd;
    nLastSeq    : WORD;
    bFirstCycle : BOOL := TRUE;
    tNow        : TIME;
    tLast       : TIME;
    tDelta      : TIME;
    wHeartbeat  : WORD;
END_VAR

(* ---- 経過時間 ---- *)
tNow := TIME();                        (* 起動からの経過時間 *)
IF bFirstCycle THEN
    tDelta   := T#0S;
    nLastSeq := GVL_ElevIO.aElevFromTS[2];   (* 起動前に残っていた指令は実行しない *)
ELSIF tNow - tLast > MAX_DELTA THEN
    tDelta := MAX_DELTA;
ELSE
    tDelta := tNow - tLast;
END_IF
tLast := tNow;
bFirstCycle := FALSE;

(* ---- 指令の種類（範囲外の値は None にして無視する） ---- *)
CASE WORD_TO_INT(GVL_ElevIO.aElevFromTS[0]) OF
    1: eCmdIn := E_ElevCmd.CarCall;
    2: eCmdIn := E_ElevCmd.HallCall;
    3: eCmdIn := E_ElevCmd.DoorOpen;
    4: eCmdIn := E_ElevCmd.DoorClose;
ELSE
    eCmdIn := E_ElevCmd.None;
END_CASE

(* ---- 制御本体 ---- *)
fbElevator(
    bCmdNew   := GVL_ElevIO.aElevFromTS[2] <> nLastSeq,
    eCmd      := eCmdIn,
    nCmdFloor := WORD_TO_INT(GVL_ElevIO.aElevFromTS[1]),
    nPersons  := LIMIT(0, WORD_TO_INT(GVL_ElevIO.aElevFromTS[3]), MAX_INPUT),
    nLoadKg   := LIMIT(0, WORD_TO_INT(GVL_ElevIO.aElevFromTS[4]), MAX_INPUT),
    tDelta    := tDelta);
nLastSeq := GVL_ElevIO.aElevFromTS[2];

(* ---- 画面へ出す値 ---- *)
wHeartbeat := wHeartbeat + 1;   (* 通信の生存確認用。WORD なので 65535 の次は 0 に戻ってよい *)

GVL_ElevIO.aElevToTS[0]  := INT_TO_WORD(fbElevator.eState);
GVL_ElevIO.aElevToTS[1]  := INT_TO_WORD(REAL_TO_INT(fbElevator.rPosition * POSITION_SCALE));
GVL_ElevIO.aElevToTS[2]  := INT_TO_WORD(fbElevator.nFloor);
GVL_ElevIO.aElevToTS[3]  := INT_TO_WORD(fbElevator.eDirection);
GVL_ElevIO.aElevToTS[4]  := INT_TO_WORD(fbElevator.nDoorPct);
GVL_ElevIO.aElevToTS[5]  := fbElevator.wCarCalls;
GVL_ElevIO.aElevToTS[6]  := fbElevator.wHallCalls;
GVL_ElevIO.aElevToTS[7]  := INT_TO_WORD(LIMIT(0, WORD_TO_INT(GVL_ElevIO.aElevFromTS[3]), MAX_INPUT));
GVL_ElevIO.aElevToTS[8]  := INT_TO_WORD(LIMIT(0, WORD_TO_INT(GVL_ElevIO.aElevFromTS[4]), MAX_INPUT));
(* 状態フラグ: bit0 超過 / bit1 警報中 / bit2 扉全開 / bit3 扉全閉 / bit4 移動中 *)
GVL_ElevIO.aElevToTS[9]  := BOOL_TO_WORD(fbElevator.bOverload)
                         OR SHL(BOOL_TO_WORD(fbElevator.eState = E_ElevState.Overload), 1)
                         OR SHL(BOOL_TO_WORD(fbElevator.nDoorPct >= 100), 2)
                         OR SHL(BOOL_TO_WORD(fbElevator.nDoorPct <= 0), 3)
                         OR SHL(BOOL_TO_WORD(fbElevator.eState = E_ElevState.Moving), 4);
GVL_ElevIO.aElevToTS[10] := nLastSeq;   (* 処理済みの通し番号（画面が受け付けを確認する） *)
GVL_ElevIO.aElevToTS[11] := INT_TO_WORD(GVL_ElevParam.MAX_LOAD_KG);
GVL_ElevIO.aElevToTS[12] := INT_TO_WORD(GVL_ElevParam.MAX_PERSONS);
GVL_ElevIO.aElevToTS[13] := INT_TO_WORD(GVL_ElevParam.FLOOR_COUNT);
GVL_ElevIO.aElevToTS[14] := wHeartbeat;
