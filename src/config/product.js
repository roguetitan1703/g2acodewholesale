const fs = require('fs');
const path = require('path');
const configPath = path.join(__dirname, 'product.json'); // Adjust path if needed

let productsToSync;

try {
    const fileContents = fs.readFileSync(configPath, 'utf-8');
    productsToSync = JSON.parse(fileContents);
} catch (err) {
    console.error('Failed to load product.json:', err.message);
    productsToSync = [];
}

module.exports = productsToSync;
