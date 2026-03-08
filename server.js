const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const GHL_API = "https://services.leadconnectorhq.com";

app.get("/", (req, res) => {
  res.send("MAYBEL Team Hub running");
});

app.get("/team", async (req, res) => {
  try {
    const response = await axios.get(
      `${GHL_API}/users/search`,
      {
        headers: {
          Authorization: `Bearer ${process.env.GHL_API_KEY}`,
          Version: "2021-07-28"
        }
      }
    );

    res.json(response.data);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.listen(3000, () => {
  console.log("Server running");
});
