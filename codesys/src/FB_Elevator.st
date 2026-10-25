(* ==========================================================================
   FB_Elevator
   目的 : エレベータ1台の制御（呼びの受け付け、運転方向の決定、扉、重量超過）
          グローバル変数には触らず、入出力だけでやり取りする（I/O は PRG_Elevator が担当）
   入力 : bCmdNew    新しい指令が来たサイクルだけ TRUE
          eCmd       指令の種類
          nCmdFloor  指令の対象階 [1..FLOOR_COUNT]
          nPersons   かごに乗っている人数 [人]
          nLoadKg    かごの積載重量 [kg]
          tDelta     前回呼んでからの経過時間
   出力 : eState, eDirection, rPosition [階], nFloor, nDoorPct [%],
          wCarCalls / wHallCalls（bit0 = 1F）, bOverload
   動き : ・呼ばれた階に向かい、着いたら扉を開ける
          ・扉は DOOR_DWELL だけ開けて閉じる（閉ボタンで短縮、開ボタンで延長）
          ・扉が開いている間に重量・人数が定格を超えたら Overload（扉を開けたまま警報）
          ・運転方向は「今の方向の呼びを片付けてから折り返す」
   履歴 : 2026-10-19  初版
   ========================================================================== *)
FUNCTION_BLOCK FB_Elevator
VAR_INPUT
    bCmdNew   : BOOL;
    eCmd      : E_ElevCmd;
    nCmdFloor : INT;
    nPersons  : INT;
    nLoadKg   : INT;
    tDelta    : TIME;
END_VAR
VAR_OUTPUT
    eState     : E_ElevState := E_ElevState.Idle;
    eDirection : E_Direction := E_Direction.Stop;
    rPosition  : REAL := 1.0;   (* 1.0 = 1F *)
    nFloor     : INT := 1;      (* いちばん近い階 *)
    nDoorPct   : INT;
    wCarCalls  : WORD;
    wHallCalls : WORD;
    bOverload  : BOOL;
END_VAR
VAR
    fbDoor           : FB_Door;
    tonDwell         : TON;
    eTravelDirection : E_Direction := E_Direction.Up;   (* 走行中の方向。停止中は次に優先して探す方向 *)
    wCarCallIn       : WORD;    (* このサイクルに押されたボタン *)
    wHallCallIn      : WORD;
    wAllCalls        : WORD;
    wAnswered        : WORD;    (* このサイクルに応答した（消す）呼び *)
    bOpenRequest     : BOOL;
    bCloseRequest    : BOOL;
    nTarget          : INT;
    rStep            : REAL;
    rNext            : REAL;
END_VAR

(* ---- 指令の受け付け（このサイクルの分だけ） ---- *)
wCarCallIn    := SEL(bCmdNew AND eCmd = E_ElevCmd.CarCall,  WORD#0, FC_FloorBit(nCmdFloor));
wHallCallIn   := SEL(bCmdNew AND eCmd = E_ElevCmd.HallCall, WORD#0, FC_FloorBit(nCmdFloor));
bOpenRequest  := bCmdNew AND eCmd = E_ElevCmd.DoorOpen;
bCloseRequest := bCmdNew AND eCmd = E_ElevCmd.DoorClose;

wAllCalls := wCarCalls OR wHallCalls OR wCarCallIn OR wHallCallIn;
bOverload := nLoadKg > GVL_ElevParam.MAX_LOAD_KG OR nPersons > GVL_ElevParam.MAX_PERSONS;
wAnswered := 0;

(* 扉を開けておく時間。DoorOpen 以外では IN が FALSE になり、自動でリセットされる *)
tonDwell(IN := eState = E_ElevState.DoorOpen, PT := GVL_ElevParam.DOOR_DWELL);

(* ---- 状態遷移 ---- *)
CASE eState OF
    E_ElevState.Idle:
        IF bOpenRequest OR (wAllCalls AND FC_FloorBit(nFloor)) <> 0 THEN
            eState := E_ElevState.DoorOpening;              (* 今いる階で呼ばれた *)
        ELSIF FC_NextCallFloor(wAllCalls, rPosition, eTravelDirection) <> 0 THEN
            eState := E_ElevState.Moving;                    (* 前と同じ方向に呼びがある *)
        ELSIF wAllCalls <> 0 THEN
            (* 同じ方向に呼びが無い → 折り返す *)
            IF eTravelDirection = E_Direction.Up THEN
                eTravelDirection := E_Direction.Down;
            ELSE
                eTravelDirection := E_Direction.Up;
            END_IF
            eState := E_ElevState.Moving;
        END_IF

    E_ElevState.DoorOpening:
        wAnswered := FC_FloorBit(nFloor);                    (* この階の呼びに応答した *)
        IF fbDoor.bIsOpen THEN
            eState := E_ElevState.DoorOpen;
        END_IF

    E_ElevState.DoorOpen:
        wAnswered := FC_FloorBit(nFloor);
        IF bOverload THEN
            eState := E_ElevState.Overload;
        ELSIF bOpenRequest THEN
            eState := E_ElevState.DoorOpening;   (* 開ボタン: 一度抜けることで待ち時間をやり直す *)
        ELSIF tonDwell.Q OR bCloseRequest THEN
            eState := E_ElevState.DoorClosing;
        END_IF

    E_ElevState.Overload:
        wAnswered := FC_FloorBit(nFloor);
        IF NOT bOverload THEN
            eState := E_ElevState.DoorOpen;      (* 降りて定格内に戻ったら、待ち時間から再開 *)
        END_IF

    E_ElevState.DoorClosing:
        (* 閉まりかけでも、開ボタン・この階の呼び・駆け込みによる超過があれば開け直す *)
        IF bOpenRequest OR bOverload OR (wAllCalls AND FC_FloorBit(nFloor)) <> 0 THEN
            eState := E_ElevState.DoorOpening;
        ELSIF fbDoor.bIsClosed THEN
            eState := E_ElevState.Idle;          (* 次の行き先は Idle で決める *)
        END_IF

    E_ElevState.Moving:
        nTarget := FC_NextCallFloor(wAllCalls, rPosition, eTravelDirection);
        IF nTarget = 0 THEN
            (* 呼びは着くまで消えないので通常は起きない。念のため次の階で止める *)
            IF eTravelDirection = E_Direction.Up THEN
                nTarget := LIMIT(1, DINT_TO_INT(TRUNC(rPosition)) + 1, GVL_ElevParam.FLOOR_COUNT);
            ELSE
                nTarget := LIMIT(1, DINT_TO_INT(TRUNC(rPosition)), GVL_ElevParam.FLOOR_COUNT);
            END_IF
        END_IF

        rStep := GVL_ElevParam.SPEED_FLOORS_PER_S * TIME_TO_REAL(tDelta) / 1000.0;
        IF eTravelDirection = E_Direction.Up THEN
            rNext := rPosition + rStep;
            IF rNext >= INT_TO_REAL(nTarget) THEN
                rNext  := INT_TO_REAL(nTarget);   (* 行き過ぎないよう階にぴったり合わせる *)
                eState := E_ElevState.DoorOpening;
            END_IF
        ELSE
            rNext := rPosition - rStep;
            IF rNext <= INT_TO_REAL(nTarget) THEN
                rNext  := INT_TO_REAL(nTarget);
                eState := E_ElevState.DoorOpening;
            END_IF
        END_IF
        rPosition := rNext;

ELSE
    (* 列挙外の値はメモリ破壊などの異常。走行を止め、扉を閉めた停止状態に戻す *)
    eState := E_ElevState.Idle;
END_CASE

(* ---- 出力（ここでまとめて決める） ---- *)
fbDoor(bOpen := eState = E_ElevState.DoorOpening
             OR eState = E_ElevState.DoorOpen
             OR eState = E_ElevState.Overload,
       tTravel := GVL_ElevParam.DOOR_TRAVEL,
       tDelta := tDelta);
nDoorPct := fbDoor.nPositionPct;

wCarCalls  := (wCarCalls  OR wCarCallIn)  AND NOT wAnswered;
wHallCalls := (wHallCalls OR wHallCallIn) AND NOT wAnswered;

nFloor := LIMIT(1, REAL_TO_INT(rPosition), GVL_ElevParam.FLOOR_COUNT);

IF eState = E_ElevState.Moving THEN
    eDirection := eTravelDirection;
ELSE
    eDirection := E_Direction.Stop;
END_IF
