const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const GHL_API = "https://services.leadconnectorhq.com";

app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>MAYBEL Team Hub</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          background: #f7f8fc;
          margin: 0;
          padding: 30px;
          color: #1f2937;
        }
        .container {
          max-width: 1000px;
          margin: 0 auto;
        }
        .card {
          background: white;
          border-radius: 16px;
          padding: 24px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.08);
          margin-bottom: 20px;
        }
        h1 {
          margin-top: 0;
        }
        button {
          background: #111827;
          color: white;
          border: none;
          padding: 12px 18px;
          border-radius: 10px;
          cursor: pointer;
          font-size: 14px;
        }
        button:hover {
          opacity: 0.9;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 20px;
        }
        th, td {
          text-align: left;
          padding: 12px;
          border-bottom: 1px solid #e5e7eb;
        }
        th {
          background: #f3f4f6;
        }
        .muted {
          color: #6b7280;
          font-size: 14px;
        }
        .status {
          display: inline-block;
          padding: 6px 10px;
          border-radius: 999px;
          background: #dcfce7;
          color: #166534;
          font-size: 12px;
          font-weight: bold;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="card">
          <h1>MAYBEL Team Hub</h1>
          <p class="muted">Basic team dashboard connected to GHL</p>
          <button onclick="loadTeam()">Load Team</button>
        </div>

        <div class="card">
          <h2>Team Members</h2>
          <div id="output" class="muted">Click "Load Team" to fetch users from GHL.</div>
        </div>
      </div>

      <script>
        async function loadTeam() {
          const output = document.getElementById("output");
          output.innerHTML = "Loading...";

          try {
            const res = await fetch("/team");
            const data = await res.json();

            const users = data.users || data.data || [];

            if (!users.length) {
              output.innerHTML = "No users found.";
              return;
            }

            let html = \`
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
            \`;

            users.forEach(user => {
              html += \`
                <tr>
                  <td>\${user.name || user.firstName || "—"}</td>
                  <td>\${user.email || "—"}</td>
                  <td><span class="status">Active</span></td>
                </tr>
              \`;
            });

            html += "</tbody></table>";
            output.innerHTML = html;
          } catch (err) {
            output.innerHTML = "Error loading team.";
          }
        }
      </script>
    </body>
    </html>
  `);
});

app.get("/team", async (req, res) => {
  try {
    const response = await axios.get(
      `${GHL_API}/users/search`,
      {
        headers: {
          Authorization: \`Bearer \${process.env.GHL_API_KEY}\`,
          Version: "2021-07-28"
        }
      }
    );

    res.json(response.data);
  } catch (error) {
    res.status(500).json({
      error: error.response?.data || error.message
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
