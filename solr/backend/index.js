const express = require('express');
const mysql = require('mysql2');
const axios = require('axios');
const app = express();

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
});

app.get('/api/posts', (req, res) => {
  db.query('SELECT * FROM posts', async (err, results) => {
    if (err) return res.status(500).send(err);
    res.json(results);
  });
});

app.post('/api/index', async (req, res) => {
  const posts = req.body; // assume array of post objects
  try {
    await axios.post(`http://${process.env.SOLR_HOST}:8983/solr/${process.env.SOLR_CORE}/update?commit=true`, posts, {
      headers: { 'Content-Type': 'application/json' }
    });
    res.send('Indexed');
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.listen(4000, () => console.log('API running on port 4000'));
