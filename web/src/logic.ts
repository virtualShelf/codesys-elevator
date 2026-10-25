// codesys/src/ の ST と同じロジックを TypeScript で再現したもの（疑似PLC 用）
// CODESYS なしで画面を試すために使う。ST 側を変えたら、こちらも同じように直すこと
//   FC_FloorBit / FC_NextCallFloor → floorBit / nextCallFloor
//   FB_Door → Door、TON → Ton、FB_Elevator → Elevator、PRG_Elevator → ElevatorPlc
import { Cmd, Direction, HR, HR_COUNT, IR, IR_COUNT, State } from "./config.ts";

// GVL_ElevParam と同じ値
export const PARAM = {
  FLOOR_COUNT: 5,
  MAX_LOAD_KG: 600,
  MAX_PERSONS: 9,
  SPEED_FLOORS_PER_S: 0.5,
  DOOR_TRAVEL_MS: 2000,
  DOOR_DWELL_MS: 5000,
  POSITION_EPS: 0.001,
};

export function floorBit(floor: number): number {
  return floor >= 1 && floor <= PARAM.FLOOR_COUNT ? 1 << (floor - 1) : 0;
}

export function nextCallFloor(calls: number, position: number, direction: number): number {
  if (direction === Direction.Up) {
    for (let f = 1; f <= PARAM.FLOOR_COUNT; f++) {
      if (calls & floorBit(f) && f >= position - PARAM.POSITION_EPS) return f;
    }
  } else if (direction === Direction.Down) {
    for (let f = PARAM.FLOOR_COUNT; f >= 1; f--) {
      if (calls & floorBit(f) && f <= position + PARAM.POSITION_EPS) return f;
    }
  }
  return 0;
}

/** IEC の TON と同じ: IN が立った瞬間から時間を測り、PT 経過で Q。IN が落ちたらリセット */
class Ton {
  private elapsed = 0;
  private prevIn = false;
  q = false;
  update(input: boolean, pt: number, dtMs: number) {
    if (!input) {
      this.elapsed = 0;
      this.q = false;
    } else {
      this.elapsed = this.prevIn ? this.elapsed + dtMs : 0;
      this.q = this.elapsed >= pt;
    }
    this.prevIn = input;
  }
}

class Door {
  private position = 0; // 0.0 = 全閉、1.0 = 全開
  pct = 0;
  isOpen = false;
  isClosed = true;
  update(open: boolean, travelMs: number, dtMs: number) {
    const step = travelMs > 0 ? dtMs / travelMs : 1;
    this.position = open ? Math.min(1, this.position + step) : Math.max(0, this.position - step);
    this.pct = Math.round(this.position * 100);
    this.isOpen = this.pct >= 100;
    this.isClosed = this.pct <= 0;
  }
}

export class Elevator {
  state: number = State.Idle;
  direction: number = Direction.Stop;
  position = 1.0;
  floor = 1;
  doorPct = 0;
  carCalls = 0;
  hallCalls = 0;
  overload = false;

  private door = new Door();
  private dwell = new Ton();
  private travelDirection: number = Direction.Up;

  step(cmdNew: boolean, cmd: number, cmdFloor: number, persons: number, loadKg: number, dtMs: number) {
    // ---- 指令の受け付け ----
    const carCallIn = cmdNew && cmd === Cmd.CarCall ? floorBit(cmdFloor) : 0;
    const hallCallIn = cmdNew && cmd === Cmd.HallCall ? floorBit(cmdFloor) : 0;
    const openRequest = cmdNew && cmd === Cmd.DoorOpen;
    const closeRequest = cmdNew && cmd === Cmd.DoorClose;

    const allCalls = this.carCalls | this.hallCalls | carCallIn | hallCallIn;
    this.overload = loadKg > PARAM.MAX_LOAD_KG || persons > PARAM.MAX_PERSONS;
    let answered = 0;

    this.dwell.update(this.state === State.DoorOpen, PARAM.DOOR_DWELL_MS, dtMs);

    // ---- 状態遷移 ----
    switch (this.state) {
      case State.Idle:
        if (openRequest || allCalls & floorBit(this.floor)) {
          this.state = State.DoorOpening;
        } else if (nextCallFloor(allCalls, this.position, this.travelDirection) !== 0) {
          this.state = State.Moving;
        } else if (allCalls !== 0) {
          this.travelDirection = this.travelDirection === Direction.Up ? Direction.Down : Direction.Up;
          this.state = State.Moving;
        }
        break;

      case State.DoorOpening:
        answered = floorBit(this.floor);
        if (this.door.isOpen) this.state = State.DoorOpen;
        break;

      case State.DoorOpen:
        answered = floorBit(this.floor);
        if (this.overload) this.state = State.Overload;
        else if (openRequest) this.state = State.DoorOpening;
        else if (this.dwell.q || closeRequest) this.state = State.DoorClosing;
        break;

      case State.Overload:
        answered = floorBit(this.floor);
        if (!this.overload) this.state = State.DoorOpen;
        break;

      case State.DoorClosing:
        if (openRequest || this.overload || allCalls & floorBit(this.floor)) {
          this.state = State.DoorOpening;
        } else if (this.door.isClosed) {
          this.state = State.Idle;
        }
        break;

      case State.Moving: {
        let target = nextCallFloor(allCalls, this.position, this.travelDirection);
        if (target === 0) {
          const base = Math.trunc(this.position);
          target = this.travelDirection === Direction.Up
            ? Math.min(PARAM.FLOOR_COUNT, Math.max(1, base + 1))
            : Math.min(PARAM.FLOOR_COUNT, Math.max(1, base));
        }
        const stepFloors = (PARAM.SPEED_FLOORS_PER_S * dtMs) / 1000;
        let next: number;
        if (this.travelDirection === Direction.Up) {
          next = this.position + stepFloors;
          if (next >= target) {
            next = target;
            this.state = State.DoorOpening;
          }
        } else {
          next = this.position - stepFloors;
          if (next <= target) {
            next = target;
            this.state = State.DoorOpening;
          }
        }
        this.position = next;
        break;
      }

      default:
        this.state = State.Idle;
    }

    // ---- 出力 ----
    const doorOpenCmd = this.state === State.DoorOpening || this.state === State.DoorOpen
      || this.state === State.Overload;
    this.door.update(doorOpenCmd, PARAM.DOOR_TRAVEL_MS, dtMs);
    this.doorPct = this.door.pct;

    this.carCalls = (this.carCalls | carCallIn) & ~answered & 0xffff;
    this.hallCalls = (this.hallCalls | hallCallIn) & ~answered & 0xffff;

    this.floor = Math.min(PARAM.FLOOR_COUNT, Math.max(1, Math.round(this.position)));
    this.direction = this.state === State.Moving ? this.travelDirection : Direction.Stop;
  }
}

const MAX_DELTA_MS = 100;
const MAX_INPUT = 9999;
const clampInput = (raw: number) => Math.min(MAX_INPUT, Math.max(0, raw >= 0x8000 ? raw - 0x10000 : raw));

/** PRG_Elevator と同じ: レジスタと Elevator の橋渡し */
export class ElevatorPlc {
  readonly ir = new Uint16Array(IR_COUNT);
  readonly hr = new Uint16Array(HR_COUNT);
  readonly elevator = new Elevator();
  private lastSeq = 0;
  private firstCycle = true;
  private heartbeat = 0;

  cycle(elapsedMs: number) {
    let dtMs: number;
    if (this.firstCycle) {
      dtMs = 0;
      this.lastSeq = this.hr[HR.cmdSeq];
    } else {
      dtMs = Math.min(MAX_DELTA_MS, elapsedMs);
    }
    this.firstCycle = false;

    const code = this.hr[HR.cmdCode];
    const cmd = code >= 1 && code <= 4 ? code : Cmd.None;
    const e = this.elevator;
    e.step(this.hr[HR.cmdSeq] !== this.lastSeq, cmd, this.hr[HR.cmdFloor],
      clampInput(this.hr[HR.persons]), clampInput(this.hr[HR.loadKg]), dtMs);
    this.lastSeq = this.hr[HR.cmdSeq];

    this.heartbeat = (this.heartbeat + 1) & 0xffff;
    this.ir[IR.state] = e.state;
    this.ir[IR.position] = Math.round(e.position * 100);
    this.ir[IR.floor] = e.floor;
    this.ir[IR.direction] = e.direction;
    this.ir[IR.doorPct] = e.doorPct;
    this.ir[IR.carCalls] = e.carCalls;
    this.ir[IR.hallCalls] = e.hallCalls;
    this.ir[IR.persons] = clampInput(this.hr[HR.persons]);
    this.ir[IR.loadKg] = clampInput(this.hr[HR.loadKg]);
    this.ir[IR.flags] = (e.overload ? 1 : 0)
      | (e.state === State.Overload ? 2 : 0)
      | (e.doorPct >= 100 ? 4 : 0)
      | (e.doorPct <= 0 ? 8 : 0)
      | (e.state === State.Moving ? 16 : 0);
    this.ir[IR.ackSeq] = this.lastSeq;
    this.ir[IR.maxLoadKg] = PARAM.MAX_LOAD_KG;
    this.ir[IR.maxPersons] = PARAM.MAX_PERSONS;
    this.ir[IR.floorCount] = PARAM.FLOOR_COUNT;
    this.ir[IR.heartbeat] = this.heartbeat;
  }
}
