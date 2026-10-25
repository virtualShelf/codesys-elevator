(* ==========================================================================
   FB_Door
   目的 : エレベータの扉の開閉の動きを模擬する
          （実機ならドア駆動装置への指令と、全開・全閉リミットスイッチの入力になる）
   入力 : bOpen    TRUE の間は開く方向、FALSE の間は閉じる方向へ動く
          tTravel  全閉から全開までの時間
          tDelta   前回呼んでからの経過時間
   出力 : nPositionPct  開き具合 [%]（0 = 全閉、100 = 全開）
          bIsOpen / bIsClosed  全開・全閉
   履歴 : 2026-10-19  初版
   ========================================================================== *)
FUNCTION_BLOCK FB_Door
VAR_INPUT
    bOpen   : BOOL;
    tTravel : TIME := T#2S;
    tDelta  : TIME;
END_VAR
VAR_OUTPUT
    nPositionPct : INT;
    bIsOpen      : BOOL;
    bIsClosed    : BOOL := TRUE;
END_VAR
VAR
    rPosition : REAL;   (* 0.0 = 全閉、1.0 = 全開 *)
    rStep     : REAL;
END_VAR

IF tTravel > T#0S THEN
    rStep := TIME_TO_REAL(tDelta) / TIME_TO_REAL(tTravel);
ELSE
    rStep := 1.0;       (* 時間 0 指定なら即座に動き切る *)
END_IF

IF bOpen THEN
    rPosition := MIN(1.0, rPosition + rStep);
ELSE
    rPosition := MAX(0.0, rPosition - rStep);
END_IF

nPositionPct := REAL_TO_INT(rPosition * 100.0);
bIsOpen      := nPositionPct >= 100;
bIsClosed    := nPositionPct <= 0;
