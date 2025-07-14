const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/productController');

router.get('/', ctrl.getAllProducts);   // GET /api/products
router.get('/:id', ctrl.getProduct);       // GET /api/products/:cwsProductId
router.post('/', ctrl.createProduct);    // POST /api/products
router.put('/:id', ctrl.updateProduct);    // PUT /api/products/:cwsProductId
router.delete('/:id', ctrl.deleteProduct);    // DELETE /api/products/:cwsProductId

module.exports = router;
