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
        h1, h2 {
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
        .error {
          color: #b91c1c;
          background: #fee2e2;
          padding: 12px;
          border-radius: 10px;
          margin-top: 12px;
          white-space: pre-wrap;
        }
        .debug-box {
          margin-top: 16px;
          padding: 14px;
          background: #0f172a;
          color: #e5e7eb;
          border-radius: 10px;
          font-size: 12px;
          overflow-x: auto;
          white-space: pre-wrap;
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

            if (!res.ok) {
              output.innerHTML = '<div class="error">Error loading team:\\n' + JSON.stringify(data, null, 2) + '</div>';
              return;
            }

            const users =
              Array.isArray(data)
                ? data
                : data.users ||
                  data.data ||
                  data.results ||
                  data.members ||
                  data.team ||
                  [];

            if (!Array.isArray(users) || users.length === 0) {
              output.innerHTML = \`
                <div>No users found.</div>
                <div class="debug-box">\${JSON.stringify(data, null, 2)}</div>
              \`;
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
              const name =
                user.name ||
                [user.firstName, user.lastName].filter(Boolean).join(" ") ||
                user.firstName ||
                "—";

              const email = user.email || user.userEmail || "—";

              html += \`
                <tr>
                  <td>\${name}</td>
                  <td>\${email}</td>
                  <td><span class="status">Active</span></td>
                </tr>
              \`;
            });

            html += "</tbody></table>";
            output.innerHTML = html;
          } catch (err) {
            output.innerHTML = '<div class="error">Error loading team.\\n' + err.message + '</div>';
          }
        }
      </script>
    </body>
    </html>
  `);
});

app.get("/team", async (req, res) => {
  try {
    const response = await axios.get(`${GHL_API}/users/search`, {
      headers: {
        Authorization: \`Bearer \${process.env.GHL_API_KEY}\`,
        Version: "2021-07-28",
        Accept: "application/json"
      }
    });

    console.log("GHL TEAM RESPONSE:");
    console.log(JSON.stringify(response.data, null, 2));

    res.json(response.data);
  } catch (error) {
    console.log("GHL TEAM ERROR:");
    console.log(JSON.stringify(error.response?.data || error.message, null, 2));

    res.status(error.response?.status || 500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

app.get("/team-debug", async (req, res) => {
  try {
    const response = await axios.get(`${GHL_API}/users/search`, {
      headers: {
        Authorization: \`Bearer \${process.env.GHL_API_KEY}\`,
        Version: "2021-07-28",
        Accept: "application/json"
      }
    });

    res.send(\`<pre>\${JSON.stringify(response.data, null, 2)}</pre>\`);
  } catch (error) {
    res
      .status(error.response?.status || 500)
      .send(\`<pre>\${JSON.stringify(error.response?.data || error.message, null, 2)}</pre>\`);
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
