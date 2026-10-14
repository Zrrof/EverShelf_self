/* EverShelf smoke and contract tests. No external test framework is required. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const js = read('assets/js/app.js');
const css = read('assets/css/corporate.css');
const api = read('api/index.php');
const db = read('api/database.php');
const de = JSON.parse(read('translations/de.json'));
const it = JSON.parse(read('translations/it.json'));

function nestedKeys(value, prefix = '', result = []) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const key of Object.keys(value)) {
            result.push(prefix + key);
            nestedKeys(value[key], prefix + key + '.', result);
        }
    }
    return result;
}

function daysUntilExpiry(date, today = new Date('2026-10-14T00:00:00Z')) {
    const target = new Date(`${date}T00:00:00Z`);
    return Math.ceil((target - today) / 86400000);
}

function matchesFilter(item, mode) {
    if (mode === 'all') return true;
    if (mode === 'unlocated') return !String(item.location || '').trim();
    const days = item.expiry_date ? daysUntilExpiry(item.expiry_date) : null;
    if (mode === 'expired') return days !== null && days < 0;
    if (mode === 'expiring') return days !== null && days >= 0 && days <= 7;
    if (mode === 'low') {
        const qty = Number(item.quantity || 0);
        const minimum = Number(item.minimum_stock ?? item.min_stock ?? 0);
        return qty <= (minimum > 0 ? minimum : 0.001);
    }
    return true;
}

function test(name, fn) {
    try { fn(); console.log(`✓ ${name}`); }
    catch (error) { console.error(`✗ ${name}`); throw error; }
}

test('Smantry-Hauptnavigation und Primäraktionen sind sichtbar verdrahtet', () => {
    for (const token of [
        'data-page="dashboard"', 'data-page="inventory"', 'data-page="shopping"', 'data-page="settings"',
        'id="nav-more-menu"', 'dashboard-primary-actions', 'onclick="showPage(\'scan\')"',
        'onclick="showPage(\'add\')"', 'onclick="addManualShoppingItem()"', 'onclick="openShoppingBarcodeScanner()"',
    ]) assert.ok(html.includes(token), `fehlt: ${token}`);
});

test('Lagerort-Bottom-Sheet und Smantry-Filter sind vorhanden', () => {
    for (const token of ['openLocationSheet()', 'location-sheet-overlay', 'inventory-filter-row', 'data-filter="expiring"', 'data-filter="expired"', 'data-filter="low"']) {
        assert.ok(html.includes(token), `fehlt: ${token}`);
    }
    for (const token of ['.location-sheet', '.inventory-filter.active', '.inventory-floating-actions', '.shopping-entry-bar']) {
        assert.ok(css.includes(token), `CSS fehlt: ${token}`);
    }
});

test('deutsche Kerntexte und vollständige Übersetzungsschlüssel', () => {
    assert.equal(de.nav.inventory, 'Vorrat');
    assert.equal(de.nav.shopping, 'Einkaufsliste');
    assert.equal(de.inventory.title, 'Alle Lagerorte');
    assert.equal(de.scan.title, 'Scanner');
    const missing = nestedKeys(it).filter((key) => !new Set(nestedKeys(de)).has(key));
    assert.deepEqual(missing, [], `fehlende deutsche Übersetzungen: ${missing.join(', ')}`);
});

test('Bestandsfilter liefern die erwarteten Ergebnisse', () => {
    const items = [
        { name: 'Alt', expiry_date: '2026-10-10', quantity: 4, location: 'frigo' },
        { name: 'Bald', expiry_date: '2026-10-18', quantity: 1, minimum_stock: 2, location: 'frigo' },
        { name: 'Ohne Ort', quantity: 0, location: '' },
    ];
    assert.deepEqual(items.filter((x) => matchesFilter(x, 'expired')).map((x) => x.name), ['Alt']);
    assert.deepEqual(items.filter((x) => matchesFilter(x, 'expiring')).map((x) => x.name), ['Bald']);
    assert.deepEqual(items.filter((x) => matchesFilter(x, 'low')).map((x) => x.name), ['Bald', 'Ohne Ort']);
    assert.deepEqual(items.filter((x) => matchesFilter(x, 'unlocated')).map((x) => x.name), ['Ohne Ort']);
});

test('Produktfelder werden migriert und gespeichert', () => {
    for (const field of ['minimum_stock', 'expiry_type', 'reminder_days', 'compartment']) {
        assert.ok(db.includes(field), `Migration fehlt: ${field}`);
        assert.ok(api.includes(field), `API-Feld fehlt: ${field}`);
    }
    assert.match(api, /INSERT INTO products[\s\S]*minimum_stock[\s\S]*compartment/);
});

test('Manuelle Einkaufslistenaufnahme und Barcode-Weiterleitung bleiben explizit', () => {
    const manual = js.match(/async function addManualShoppingItem\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
    assert.match(manual, /window\.prompt/);
    assert.match(manual, /shopping_add/);
    const scanner = js.match(/function openShoppingBarcodeScanner\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
    assert.match(scanner, /toggleShoppingScanAddMode/);
    assert.match(scanner, /showPage\('scan'\)/);
});

test('Hintergrundprozesse fügen keine Einkaufsartikel mehr hinzu', () => {
    for (const name of ['autoAddCriticalItems', '_screensaverAutoAddItems']) {
        const body = js.match(new RegExp(`function ${name}[^\\{]*\\{([\\s\\S]*?)\\n\\}`, 'm'))?.[1] || '';
        assert.match(body, /return;/, `${name} hat keinen Schutz-Return`);
    }
});

console.log('Alle EverShelf-Tests bestanden.');
