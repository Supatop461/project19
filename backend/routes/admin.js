const express = require('express');
const router = express.Router();
const db = require('../../db');


// Get all products
router.get('/products', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM products');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add new product
router.post('/products', async (req, res) => {
  const {
    product_name,
    description,
    price,
    cost,
    stock_quantity,
    category_id,
    subcategory_id,
    image_url
  } = req.body;

  try {
    const result = await db.query(
      `INSERT INTO products
        (product_name, description, price, cost, stock_quantity, category_id, subcategory_id, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        product_name,
        description,
        price,
        cost,
        stock_quantity,
        category_id,
        subcategory_id,
        image_url
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});




module.exports = router;
