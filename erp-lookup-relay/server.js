/* ------------------------------------------------------------------------
   LGMC ERP Lookup Relay
   ------------------------------------------------------------------------
   Purpose:
     Runs on a machine on the SAME local network as your SQL Server
     ("lgmc-db"). Exposes a simple HTTP endpoint the Deliveries app calls
     directly from the browser (no Google Apps Script involved, and your
     database is never exposed to the internet).

   Setup:
     1. Install Node.js (https://nodejs.org) on a PC/server on the same
        network as lgmc-db — this machine, or the SQL Server box itself,
        works fine.
     2. Put this folder somewhere on that machine, e.g. C:\ErpLookupRelay
     3. Open a command prompt in that folder and run:
          npm install
     4. Fill in DB_PASSWORD and DB_DATABASE below with your real values.
     5. Run:
          npm start
        You should see "ERP lookup relay running on http://localhost:4000"
     6. Test it by visiting, in a browser on that same machine:
          http://localhost:4000/lookup?docNo=SOME_REAL_DOC_NO
        You should get back a JSON response.
     7. Find this machine's LAN IP address (run "ipconfig" in cmd, look
        for IPv4 Address, e.g. 192.168.1.50).
     8. In deliveries.html, set:
          const ERP_LOOKUP_URL = "http://192.168.1.50:4000/lookup";
        (matching the IP/port from step 7) so the app can reach this relay
        from any computer on your office network.
     9. For everyday use, keep this running persistently — e.g. set it up
        as a Windows Service with a tool like NSSM (https://nssm.cc), or
        run it via Task Scheduler at machine startup, so nobody has to
        remember to start it manually.

   Security notes:
     - This has NO authentication built in — anyone who can reach this
       machine's IP and port 4000 can query it. Keep it on a trusted
       office LAN only; do NOT forward this port to the internet.
     - If you want basic protection, set API_KEY below to a private
       value, then send it as a header (x-api-key) from the app.
     - Never commit your real DB password to source control or share it
       in chat/screenshots.

   NOTE ON COLUMN NAMES:
     InvoiceNo and Remarks below are placeholder column names on iwApinv.
     If your actual columns are named differently (e.g. InvNo, VendorInvNo,
     Notes), update the SELECT list to match your real schema.
   ------------------------------------------------------------------------ */

const express = require("express");
const cors = require("cors");
const sql = require("mssql");

const app = express();
app.use(cors()); // Lets the browser call this relay from a different origin/port than the relay itself.

const PORT = 4000;

// Optional simple protection. Leave blank ("") to disable.
const API_KEY = "";

// ---- Fill these in with your real values ----
const config = {
  server: "LGMC-DB",                       // matches "Data Source=lgmc-db"
  user : "sa",                             // matches "User ID=sa"
  password: "s@p@ssw0rd1", // matches "Password=..."
  database: "LIVEDB_LGMC2024", // the database that contains iwApinv
  options: {
    encrypt: true,                // matches "Encrypt=True"
    trustServerCertificate: true, // matches "TrustServerCertificate=True"
  },
  pool: {
    max: 5,
    min: 0,
    idleTimeoutMillis: 30000
  },
  requestTimeout: 0 // matches "Command Timeout=0" (no timeout); set a number in ms if you'd rather cap it
};

app.get("/lookup", async (req, res) => {
  if (API_KEY && req.header("x-api-key") !== API_KEY){
    return res.status(401).json({ status: "error", message: "Unauthorized" });
  }

  const docNo = req.query.docNo;
  if (!docNo) {
    return res.status(400).json({ status: "error", message: "Missing docNo parameter" });
  }

  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
  .input("DocNo", sql.NVarChar, docNo)
  .query(`
    SELECT
      Refno AS InvoiceNo,
      Remarks,
      dbo.udf_GetFullName(FK_ASUPost) AS PreparedBy,
      dbo.udf_GetFullName(FK_faVendors) AS Department,
      DocNo,
      ROUND(curramt, 2) AS Amount,
      ROUND(vatamt, 2) AS Vat,
      ROUND(netlocamt, 2) AS NetLocAmt,
      ROUND(curramt - vatamt, 2) AS NetOfVat,
      ROUND((curramt - vatamt) * 0.01, 2) AS WithTax,
      ROUND(discount, 2) AS Discount,
      ROUND(curramt - ((curramt - vatamt) * 0.01) - discount, 2) AS TotalPayable
    FROM iwApinv
    WHERE DocNo = @DocNo
  `);

if (result.recordset.length === 0) {
  return res.json({ status: "error", message: "No matching Doc No. found in the ERP." });
}

const row = result.recordset[0];
return res.json({
  status: "ok",
  supplier: row.Department,
  preparedBy: row.PreparedBy,
  invoice: row.InvoiceNo,      // <-- fixed: matches the SQL alias exactly
  remarks: row.Remarks,
  docNo: row.DocNo,
  amount: row.Amount,
  vat: row.Vat,
  netvat: row.NetOfVat,
  ewt1: row.WithTax,
  discount: row.Discount,
  total: row.TotalPayable
});

  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: "error", message: "ERP connection failed: " + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`ERP lookup relay running on http://localhost:${PORT}`);
});