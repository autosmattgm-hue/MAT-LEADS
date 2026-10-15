const fs = require("node:fs");
["e:/jjjjjj/v6.cjs", "e:/jjjjjj/verify6.log", "e:/jjjjjj/up1.cjs", "e:/jjjjjj/upFIN.cjs", "e:/jjjjjj/del2.cjs", "e:/jjjjjj/diag1.cjs", "e:/jjjjjj/diag2.cjs", "e:/jjjjjj/verify_fix.cjs", "e:/jjjjjj/cleanup_fix.cjs"].forEach((f) => { try { fs.unlinkSync(f); } catch (e) {} });
