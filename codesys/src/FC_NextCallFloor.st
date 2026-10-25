(* ==========================================================================
   FC_NextCallFloor
   目的 : 進行方向の先にある、いちばん近い呼びの階を探す
          （エレベータの基本的な運転方式：今の方向の呼びを順に片付けてから折り返す）
   入力 : wCalls      呼び（かご内 OR 乗り場。bit0 = 1F）
          rPosition   かごの現在位置 [階]
          eDirection  探す方向
   戻り : 見つかった階 [1..FLOOR_COUNT]。無ければ 0
   履歴 : 2026-10-19  初版
   ========================================================================== *)
FUNCTION FC_NextCallFloor : INT
VAR_INPUT
    wCalls     : WORD;
    rPosition  : REAL;
    eDirection : E_Direction;
END_VAR
VAR
    nFloor : INT;
END_VAR

FC_NextCallFloor := 0;

CASE eDirection OF
    E_Direction.Up:
        (* 下から順に見て、今の位置以上で最初に見つかった呼び *)
        FOR nFloor := 1 TO GVL_ElevParam.FLOOR_COUNT DO
            IF (wCalls AND FC_FloorBit(nFloor)) <> 0
               AND INT_TO_REAL(nFloor) >= rPosition - GVL_ElevParam.POSITION_EPS THEN
                FC_NextCallFloor := nFloor;
                RETURN;
            END_IF
        END_FOR

    E_Direction.Down:
        (* 上から順に見て、今の位置以下で最初に見つかった呼び *)
        FOR nFloor := GVL_ElevParam.FLOOR_COUNT TO 1 BY -1 DO
            IF (wCalls AND FC_FloorBit(nFloor)) <> 0
               AND INT_TO_REAL(nFloor) <= rPosition + GVL_ElevParam.POSITION_EPS THEN
                FC_NextCallFloor := nFloor;
                RETURN;
            END_IF
        END_FOR

ELSE
    ;   (* 停止方向には「先」が無い *)
END_CASE
