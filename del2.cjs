const fs = require("node:fs");
["e:/jjjjjj/upFIN.cjs", "e:/jjjjjj/upFINAL.log"].forEach((f) => { try { fs.unlinkSync(f); } catch (e) {} });
