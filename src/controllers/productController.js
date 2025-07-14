const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../config/product.json');

/* ------------  Helper utilities  ------------ */

function readProducts() {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf‑8');
    return JSON.parse(raw || '[]');
}

function writeProducts(data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/* ------------  Validators  ------------ */

function isValidProduct(p) {
    return (
        typeof p.cwsProductId === 'string' &&
        typeof p.g2aProductId === 'string' &&
        (p.profit === undefined || typeof p.profit === 'number')
    );
}

/* ------------  CRUD handlers  ------------ */

exports.getAllProducts = (req, res) => {
    return res.json(readProducts());
};

exports.getProduct = (req, res) => {
    const { id } = req.params;           // use cwsProductId as path param
    const product = readProducts().find(p => p.cwsProductId === id);
    if (!product) return res.status(404).json({ error: 'Not found' });
    res.json(product);
};

exports.createProduct = (req, res) => {
    const newProduct = req.body;
    if (!isValidProduct(newProduct))
        return res.status(400).json({ error: 'Invalid payload' });

    const products = readProducts();
    if (products.some(p => p.cwsProductId === newProduct.cwsProductId))
        return res.status(409).json({ error: 'Product already exists' });

    products.push(newProduct);
    writeProducts(products);
    res.status(201).json(newProduct);
};

exports.updateProduct = (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    const products = readProducts();
    const idx = products.findIndex(p => p.cwsProductId === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });

    const updated = { ...products[idx], ...updates };
    if (!isValidProduct(updated))
        return res.status(400).json({ error: 'Invalid payload' });

    products[idx] = updated;
    writeProducts(products);
    res.json(updated);
};

exports.deleteProduct = (req, res) => {
    const { id } = req.params;
    const products = readProducts();
    const filtered = products.filter(p => p.cwsProductId !== id);
    if (filtered.length === products.length)
        return res.status(404).json({ error: 'Not found' });

    writeProducts(filtered);
    res.status(204).end();
};
