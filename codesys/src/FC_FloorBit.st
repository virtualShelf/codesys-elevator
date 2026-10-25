(* ==========================================================================
   FC_FloorBit
   目的 : 階番号を、呼びを表す WORD のビットに変換する（bit0 = 1F）
   入力 : nFloor  階 [1..FLOOR_COUNT]
   戻り : 該当ビットだけ立った WORD。範囲外の階は 0（呼びとして扱わない）
   履歴 : 2026-10-19  初版
   ========================================================================== *)
FUNCTION FC_FloorBit : WORD
VAR_INPUT
    nFloor : INT;
END_VAR

IF nFloor >= 1 AND nFloor <= GVL_ElevParam.FLOOR_COUNT THEN
    FC_FloorBit := SHL(WORD#1, nFloor - 1);
ELSE
    FC_FloorBit := 0;   (* 画面から範囲外の階が来ても、存在しない階を呼ばない *)
END_IF
