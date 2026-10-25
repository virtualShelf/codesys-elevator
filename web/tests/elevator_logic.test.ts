// エレベータのロジック（src/logic.ts = ST と同じ動き）のシナリオテスト
// 実行: node --test tests/elevator_logic.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ElevatorPlc, PARAM } from "../src/logic.ts";
import { Cmd, Direction, HR, IR, State } from "../src/config.ts";

const CYCLE_MS = 10;

class Rig {
  plc = new ElevatorPlc();
  seq = 0;
  constructor() {
    this.plc.cycle(0); // 初回サイクル
  }
  run(ms: number) {
    for (let t = 0; t < ms; t += CYCLE_MS) this.plc.cycle(CYCLE_MS);
  }
  /** 状態が条件を満たすまで回す（上限つき） */
  until(cond: () => boolean, limitMs = 30_000) {
    for (let t = 0; t < limitMs; t += CYCLE_MS) {
      if (cond()) return t;
      this.plc.cycle(CYCLE_MS);
    }
    assert.fail("条件を満たさないまま " + limitMs + "ms 経過: state=" + this.state);
  }
  command(code: number, floor = 0) {
    // 画面と同じく、種類・階・通し番号をまとめて書く（FC16 相当）
    this.seq = (this.seq + 1) & 0xffff;
    this.plc.hr[HR.cmdCode] = code;
    this.plc.hr[HR.cmdFloor] = floor;
    this.plc.hr[HR.cmdSeq] = this.seq;
    this.plc.cycle(CYCLE_MS);
    assert.equal(this.plc.ir[IR.ackSeq], this.seq, "指令が受け付けられていない");
  }
  passengers(persons: number, loadKg: number) {
    this.plc.hr[HR.persons] = persons;
    this.plc.hr[HR.loadKg] = loadKg;
    this.plc.cycle(CYCLE_MS);
  }
  get state() { return this.plc.ir[IR.state]; }
  get floor() { return this.plc.ir[IR.floor]; }
  get position() { return this.plc.ir[IR.position] / 100; }
  get flags() { return this.plc.ir[IR.flags]; }
}

test("3F で呼ぶと 1F から上がってきて扉が開く", () => {
  const r = new Rig();
  assert.equal(r.state, State.Idle);
  assert.equal(r.floor, 1);
  r.command(Cmd.HallCall, 3);
  r.until(() => r.state === State.Moving);
  assert.equal(r.plc.ir[IR.direction], Direction.Up);
  r.until(() => r.state === State.DoorOpen);
  assert.equal(r.position, 3);
  assert.equal(r.plc.ir[IR.hallCalls], 0, "応答した呼びは消える");
  assert.ok(r.flags & 4, "扉全開フラグ");
});

test("行き先 5F を押し、閉ボタンで出発して 5F に着く", () => {
  const r = new Rig();
  r.command(Cmd.HallCall, 3);
  r.until(() => r.state === State.DoorOpen);
  r.passengers(2, 130);
  r.command(Cmd.CarCall, 5);
  assert.equal(r.plc.ir[IR.carCalls], 1 << 4);
  r.command(Cmd.DoorClose);
  assert.equal(r.state, State.DoorClosing);
  r.until(() => r.state === State.Moving);
  r.until(() => r.state === State.DoorOpen);
  assert.equal(r.position, 5);
  assert.equal(r.plc.ir[IR.carCalls], 0);
});

test("扉は開いてから DOOR_DWELL 経つと自動で閉まる", () => {
  const r = new Rig();
  r.command(Cmd.HallCall, 1); // 今いる階
  r.until(() => r.state === State.DoorOpen);
  const waited = r.until(() => r.state === State.DoorClosing);
  assert.ok(Math.abs(waited - PARAM.DOOR_DWELL_MS) <= 2 * CYCLE_MS, "待ち時間 " + waited + "ms");
  r.until(() => r.state === State.Idle);
  assert.ok(r.flags & 8, "扉全閉フラグ");
});

test("重量オーバーで警報、扉は開いたまま。降りれば元に戻る", () => {
  const r = new Rig();
  r.command(Cmd.HallCall, 1);
  r.until(() => r.state === State.DoorOpen);
  r.passengers(8, 650); // 人数は定員内、重量だけ超過
  assert.equal(r.state, State.Overload);
  assert.ok(r.flags & 1 && r.flags & 2, "超過・警報フラグ");
  r.command(Cmd.DoorClose);
  r.run(PARAM.DOOR_DWELL_MS * 2);
  assert.equal(r.state, State.Overload, "超過中は閉ボタンでも閉まらない");
  assert.equal(r.plc.ir[IR.doorPct], 100);
  r.passengers(7, 560);
  assert.equal(r.state, State.DoorOpen);
});

test("人数だけのオーバーでも警報になる", () => {
  const r = new Rig();
  r.command(Cmd.HallCall, 1);
  r.until(() => r.state === State.DoorOpen);
  r.passengers(PARAM.MAX_PERSONS + 1, 300);
  assert.equal(r.state, State.Overload);
});

test("閉まりかけで駆け込み（超過）すると開け直す", () => {
  const r = new Rig();
  r.command(Cmd.HallCall, 1);
  r.until(() => r.state === State.DoorOpen);
  r.command(Cmd.DoorClose);
  r.run(500);
  assert.equal(r.state, State.DoorClosing);
  r.passengers(10, 700);
  assert.equal(r.state, State.DoorOpening);
});

test("上昇中に途中の階で呼ばれたら、先にそこで止まる", () => {
  const r = new Rig();
  r.command(Cmd.CarCall, 5);
  r.until(() => r.state === State.Moving);
  r.until(() => r.position >= 2.5);
  r.command(Cmd.HallCall, 4);
  r.until(() => r.state === State.DoorOpen);
  assert.equal(r.position, 4, "4F で先に止まる");
  r.until(() => r.state === State.DoorOpen && r.position === 5);
});

test("通り過ぎた階の呼びは、折り返してから応える", () => {
  const r = new Rig();
  r.command(Cmd.CarCall, 5);
  r.until(() => r.position >= 2.5);
  r.command(Cmd.HallCall, 2); // もう通り過ぎた
  r.until(() => r.state === State.DoorOpen);
  assert.equal(r.position, 5, "まず 5F");
  r.until(() => r.state === State.Moving);
  assert.equal(r.plc.ir[IR.direction], Direction.Down);
  r.until(() => r.state === State.DoorOpen);
  assert.equal(r.position, 2);
});

test("同じ指令を2回送っても、通し番号が変わればどちらも受け付ける", () => {
  const r = new Rig();
  r.command(Cmd.HallCall, 1);
  r.until(() => r.state === State.DoorOpen);
  r.command(Cmd.DoorOpen);
  assert.equal(r.state, State.DoorOpening); // 開ボタンで待ち時間をやり直す
  r.run(50);
  r.command(Cmd.DoorOpen);
  assert.equal(r.state, State.DoorOpening);
});

test("存在しない階の呼びは無視する", () => {
  const r = new Rig();
  r.command(Cmd.CarCall, 9);
  r.command(Cmd.HallCall, 0);
  r.run(1000);
  assert.equal(r.plc.ir[IR.carCalls], 0);
  assert.equal(r.plc.ir[IR.hallCalls], 0);
  assert.equal(r.state, State.Idle);
});
