const express = require('express');
const router = express.Router();
const pool = require('../db');

// ดึงผู้ใช้ทั้งหมด
router.get('/users', async (req, res) => {
  const result = await pool.query('SELECT * FROM users');
  res.json(result.rows);
});

module.exports = router;
