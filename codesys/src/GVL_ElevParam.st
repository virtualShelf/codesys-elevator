(* ==========================================================================
   GVL_ElevParam : エレベータの仕様（定数）
   画面側（web/src/config.ts）は IR11〜13 で受け取った値を使うので、
   ここを変えれば画面も追従する（FLOOR_COUNT は最大 16）
   ========================================================================== *)
{attribute 'qualified_only'}   (* CODESYS 独自: GVL_ElevParam.FLOOR_COUNT の形でしか書けないようにする *)
VAR_GLOBAL CONSTANT
    FLOOR_COUNT        : INT  := 5;       (* 階数 [階]。1F〜5F。呼びは WORD のビットで持つので最大 16 *)
    MAX_LOAD_KG        : INT  := 600;     (* 定格積載量 [kg] *)
    MAX_PERSONS        : INT  := 9;       (* 定員 [人] *)
    SPEED_FLOORS_PER_S : REAL := 0.5;     (* かごの速さ [階/s] *)
    DOOR_TRAVEL        : TIME := T#2S;    (* 扉が全閉から全開になるまでの時間 *)
    DOOR_DWELL         : TIME := T#5S;    (* 扉を開けておく時間（閉ボタンで短縮できる） *)
    POSITION_EPS       : REAL := 0.001;   (* 階に着いたかの判定の許容差 [階] *)
END_VAR
