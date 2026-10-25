(* ==========================================================================
   GVL_ElevIO : Modbus TCP Slave の I/O マッピング先
   ・aElevToTS   → ModbusTCP Slave の「Input Registers」(%QW) にマッピング（20 個）
   ・aElevFromTS → ModbusTCP Slave の「Holding Registers」(%IW) にマッピング（10 個）
   各レジスタの意味は README.md のレジスタマップ表を参照
   ========================================================================== *)
{attribute 'qualified_only'}   (* CODESYS 独自: GVL_ElevIO.aElevToTS の形でしか書けないようにする *)
VAR_GLOBAL
    aElevToTS   : ARRAY[0..19] OF WORD;   (* PLC → TypeScript（FC04 で読まれる） *)
    aElevFromTS : ARRAY[0..9]  OF WORD;   (* TypeScript → PLC（FC16 で書かれる） *)
END_VAR
