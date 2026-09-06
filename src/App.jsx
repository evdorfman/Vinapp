import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Search, X, ChevronRight, Trash2, Pencil, ArrowLeft, Image as ImageIcon, LayoutGrid, List as ListIcon, MessageCircle, Send, Camera, RefreshCw, TrendingUp, Bot, Sparkles, ExternalLink } from 'lucide-react';
import { ANTHROPIC_ENDPOINT, MODEL } from './lib/api.js';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';

const STATUS = ['In inventory (no listing info)', 'In inventory (ready to list)', 'Listed', 'Sold - not shipped', 'Shipped', 'Delivered', 'Complete', 'Cancelled / Delisted'];
const PRE_LISTING = ['In inventory (no listing info)', 'In inventory (ready to list)'];
const isPreListing = (status) => PRE_LISTING.includes(status);
const POST_SALE = ['Sold - not shipped', 'Shipped', 'Delivered', 'Complete'];
const isPostSale = (status) => POST_SALE.includes(status);

const NEXT_ACTION = {
  'In inventory (no listing info)': { next: 'In inventory (ready to list)', label: 'Add listing info' },
  'In inventory (ready to list)': { next: 'Listed', label: 'List' },
  'Listed': { next: 'Sold - not shipped', label: 'Mark sold' },
  'Sold - not shipped': { next: 'Shipped', label: 'Mark shipped' },
  'Shipped': { next: 'Delivered', label: 'Mark delivered' },
  'Delivered': { next: 'Complete', label: 'Complete' },
  'Complete': null,
  'Cancelled / Delisted': null,
};

function withAutoListingStatus(card) {
  if (card.status === 'In inventory (no listing info)' && (card.listingTitle || card.description)) {
    return { ...card, status: 'In inventory (ready to list)' };
  }
  return card;
}

function applyAdvance(card) {
  const action = NEXT_ACTION[card.status];
  if (!action) return card;
  const today = new Date().toISOString().slice(0, 10);
  const patch = { ...card, status: action.next };
  if (action.next === 'Listed' && !patch.postedDate) patch.postedDate = today;
  if (action.next === 'Sold - not shipped') {
    if (!patch.soldDate) patch.soldDate = today;
    if (!patch.soldPrice) patch.soldPrice = patch.buyItNowPrice || '';
  }
  if (action.next === 'Shipped') {
    if (!patch.dropOffDate) patch.dropOffDate = today;
    if (!patch.deliveryStatus) patch.deliveryStatus = 'In transit';
  }
  if (action.next === 'Delivered') {
    if (!patch.deliveredDate) patch.deliveredDate = today;
    patch.deliveryStatus = 'Delivered';
  }
  return patch;
}


const STATUS_STYLE = {
  'In inventory (no listing info)': 'bg-stone-100 text-stone-600',
  'In inventory (ready to list)': 'bg-stone-200 text-stone-700',
  'Listed': 'bg-amber-100 text-amber-800',
  'Sold - not shipped': 'bg-blue-100 text-blue-800',
  'Shipped': 'bg-indigo-100 text-indigo-800',
  'Delivered': 'bg-teal-100 text-teal-800',
  'Complete': 'bg-emerald-100 text-emerald-800',
  'Cancelled / Delisted': 'bg-red-100 text-red-700',
};

const DELIVERY_STATUS = ['In transit', 'Out for delivery', 'Delivered', 'Delayed', 'Returned', 'Lost'];

const ALLOWED_EXTRACT_KEYS = ['name', 'cardType', 'setName', 'cardNumber', 'rarity', 'language', 'manufacturingInfo'];
function sanitizeExtracted(obj) {
  const out = {};
  ALLOWED_EXTRACT_KEYS.forEach((k) => { if (obj && typeof obj[k] === 'string') out[k] = obj[k]; });
  return out;
}

function findDuplicateCard(cards, candidate) {
  const norm = (s) => (s || '').trim().toLowerCase();
  if (!norm(candidate.name)) return null;
  return cards.find((c) => {
    if (norm(c.name) !== norm(candidate.name)) return false;
    if (norm(c.setName) !== norm(candidate.setName)) return false;
    if (candidate.cardNumber && c.cardNumber && norm(c.cardNumber) !== norm(candidate.cardNumber)) return false;
    return true;
  }) || null;
}

const emptyCard = () => ({
  id: crypto.randomUUID(),
  inventoryNumber: '',
  cardType: '',
  name: '',
  cardNumber: '',
  setName: '',
  rarity: '',
  language: '',
  manufacturingInfo: '',
  details: '',
  sku: '',
  condition: '',
  graded: false,
  gradingCompany: '',
  grade: '',
  certNumber: '',
  hasPhotoFront: false,
  hasPhotoBack: false,
  purchasePrice: '',
  purchaseDate: '',
  purchaseLocation: '',
  storageLocation: '',
  status: 'In inventory (no listing info)',
  listingLink: '',
  listingTitle: '',
  ebayItemId: '',
  ebayCategoryId: '',
  postedDate: '',
  description: '',
  buyItNowPrice: '',
  priceHistory: [],
  lastPriceCheck: '',
  comparablePrice: '',
  compHistory: [],
  autoAdjustEnabled: false,
  autoAdjustUpPercent: '',
  autoAdjustDownPercent: '',
  floorPrice: '',
  floorPercentOfCost: '',
  soldPrice: '',
  soldDate: '',
  shippingCost: '',
  fees: '',
  buyerName: '',
  buyerUsername: '',
  orderNumber: '',
  deliveryAddress: '',
  shippingCarrier: '',
  shippingService: '',
  dropOffDate: '',
  trackingNumber: '',
  deliveryStatus: '',
  estDeliveryDate: '',
  deliveredDate: '',
});

const money = (n) => {
  const v = Number(n);
  if (!n || isNaN(v)) return '—';
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
};

const shortMoney = (n) => {
  const v = Number(n);
  if (!n || isNaN(v)) return '';
  return '$' + Math.round(v).toLocaleString('en-US');
};

function parseCardNumber(cn) {
  if (!cn) return null;
  const m = String(cn).match(/(\d+)\s*\/\s*(\d+)/);
  if (!m) return null;
  const num = parseInt(m[1], 10);
  const total = parseInt(m[2], 10);
  if (!num || !total) return null;
  return { num, total };
}

const num = (n) => (n === '' || n === null || n === undefined || isNaN(Number(n)) ? 0 : Number(n));

function formatTimestamp(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }); }
  catch (e) { return iso; }
}

async function fetchLiveComp(card) {
  const query = [card.name, card.setName, card.cardNumber, card.condition, card.graded ? `${card.gradingCompany} ${card.grade}` : ''].filter(Boolean).join(' ');
  const response = await fetch(ANTHROPIC_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 800,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{
        role: 'user',
        content: `Search eBay for recent sold or completed listings matching this trading card: "${query}". Estimate the current average selling price in USD based on comparable recent sales. After your research, respond with ONLY a single final line in exactly this format and nothing after it:\nRESULT: {"average": <number>, "note": "<one short sentence>"}`,
      }],
    }),
  });
  const data = await response.json();
  const text = (data.content || []).map((b) => (b.type === 'text' ? b.text : '')).join('\n');
  const match = text.match(/RESULT:\s*(\{.*\})/s);
  if (!match) throw new Error('No result found');
  const parsed = JSON.parse(match[1]);
  if (typeof parsed.average !== 'number') throw new Error('Invalid result');
  return parsed;
}

async function generateListingCopy(card) {
  const details = [
    card.name, card.setName, card.cardNumber, card.rarity, card.language, card.manufacturingInfo,
    card.condition, card.graded ? `${card.gradingCompany} ${card.grade} graded` : '',
  ].filter(Boolean).join(', ');
  const response = await fetch(ANTHROPIC_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Write an eBay listing for this trading card: ${details}. Return ONLY a raw JSON object, no markdown fences, no explanation, with exactly two keys: "title" (under 80 characters, eBay-style, front-loaded with the details buyers search for) and "description" (3-5 short honest sentences about the card and its condition, no fluff or hype).`,
      }],
    }),
  });
  const data = await response.json();
  const text = (data.content || []).map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
  const clean = text.replace(/^```json/i, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(clean);
  if (!parsed.title || !parsed.description) throw new Error('Invalid listing result');
  return parsed;
}

async function fetchSetChecklist(setName, total, cardType) {
  const response = await fetch(ANTHROPIC_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{
        role: 'user',
        content: `Research the full checklist for the "${setName}" ${cardType || 'trading card'} set, which has ${total} cards numbered 1 through ${total}. For each number, find the card's name and an approximate current market price in USD (raw/ungraded, near-mint). After your research, respond with ONLY a final line in exactly this format and nothing else after it:\nRESULT: [{"num":1,"name":"...","price":12.5},{"num":2,"name":"...","price":null}]\nInclude one entry per number from 1 to ${total}. Use null for price if you can't find a reliable one. Keep names short.`,
      }],
    }),
  });
  const data = await response.json();
  const text = (data.content || []).map((b) => (b.type === 'text' ? b.text : '')).join('\n');
  const match = text.match(/RESULT:\s*(\[.*\])/s);
  if (!match) throw new Error('No checklist result found');
  const parsed = JSON.parse(match[1]);
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Invalid checklist result');
  return parsed;
}

const formatInv = (n) => 'INV-' + String(n).padStart(4, '0');

function sampleCards() {
  const base = emptyCard();
  return [
    {
      ...base, id: crypto.randomUUID(), name: 'Charizard', cardType: 'Pokemon', setName: 'Base Set', cardNumber: '4/102',
      rarity: 'Holo rare', language: 'English', manufacturingInfo: 'Unlimited', condition: 'Near mint',
      purchasePrice: '180', purchaseDate: '2026-06-02', purchaseLocation: 'Local card show',
      storageLocation: 'Binder 1, sleeve 4', status: 'In inventory (no listing info)', comparablePrice: '310',
    },
    {
      ...base, id: crypto.randomUUID(), name: 'Blastoise', cardType: 'Pokemon', setName: 'Base Set', cardNumber: '2/102',
      rarity: 'Holo rare', language: 'English', manufacturingInfo: 'Unlimited', condition: 'Lightly played',
      purchasePrice: '65', purchaseDate: '2026-06-10', purchaseLocation: 'eBay',
      status: 'Listed', comparablePrice: '95', buyItNowPrice: '89.99', listingLink: 'https://ebay.com/itm/example1',
      ebayCategoryId: '183454', postedDate: '2026-07-01',
      description: 'Base Set Blastoise, lightly played condition. See photos for centering and edge wear.',
      priceHistory: [{ date: '2026-07-01', price: '99.99' }, { date: '2026-07-20', price: '89.99' }],
      lastPriceCheck: '2026-08-15T14:30:00.000Z',
      compHistory: [
        { date: '2026-07-01T09:00:00.000Z', price: 82 },
        { date: '2026-07-15T09:00:00.000Z', price: 88 },
        { date: '2026-07-29T09:00:00.000Z', price: 91 },
        { date: '2026-08-15T14:30:00.000Z', price: 95 },
      ],
    },
    {
      ...base, id: crypto.randomUUID(), name: 'Umbreon VMAX', cardType: 'Pokemon', setName: 'Evolving Skies', cardNumber: '215/203',
      rarity: 'Secret rare (alt art)', language: 'English', condition: 'Near mint', graded: true,
      gradingCompany: 'PSA', grade: '9', certNumber: '84921103',
      purchasePrice: '210', purchaseDate: '2026-05-14', purchaseLocation: 'Local card shop',
      status: 'Sold - not shipped', buyItNowPrice: '340', comparablePrice: '335',
      listingLink: 'https://ebay.com/itm/example2', ebayItemId: '256789012345', postedDate: '2026-07-05',
      soldPrice: '335', soldDate: '2026-08-30', shippingCost: '5.50', fees: '38.50',
      buyerName: 'J. Alvarez', buyerUsername: 'cardcollector_j', orderNumber: '08-13579-24681',
    },
    {
      ...base, id: crypto.randomUUID(), name: 'Venusaur', cardType: 'Pokemon', setName: 'Base Set', cardNumber: '15/102',
      rarity: 'Holo rare', language: 'English', manufacturingInfo: '1st edition', condition: 'Excellent',
      purchasePrice: '145', purchaseDate: '2026-04-22', purchaseLocation: 'Estate sale',
      status: 'Shipped', buyItNowPrice: '220', soldPrice: '220', soldDate: '2026-08-28',
      shippingCost: '4.80', fees: '25.30', buyerName: 'M. Chen', buyerUsername: 'mchen_tcg',
      orderNumber: '08-24680-13579', shippingCarrier: 'USPS', shippingService: 'Ground Advantage',
      dropOffDate: '2026-08-29', trackingNumber: '9400111899223344556677', deliveryStatus: 'In transit',
      estDeliveryDate: '2026-09-03',
    },
    {
      ...base, id: crypto.randomUUID(), name: 'Amazing Spider-Man #300', cardType: 'Comic', setName: 'Marvel', cardNumber: '#300',
      condition: 'Very fine', graded: true, gradingCompany: 'CGC', grade: '9.2', certNumber: '4021558009',
      purchasePrice: '320', purchaseDate: '2026-03-10', purchaseLocation: 'Comic convention',
      status: 'Complete', buyItNowPrice: '480', soldPrice: '480', soldDate: '2026-08-10',
      shippingCost: '9.20', fees: '43.50', buyerName: 'R. Patel', buyerUsername: 'silveragefan',
      orderNumber: '08-11223-34455', shippingCarrier: 'USPS', shippingService: 'Priority Mail',
      dropOffDate: '2026-08-11', trackingNumber: '9405511899223344556699', deliveryStatus: 'Delivered',
      estDeliveryDate: '2026-08-14', deliveredDate: '2026-08-13',
    },
  ];
}

const thumbCache = {};
function useThumbnail(card) {
  const [url, setUrl] = useState(thumbCache[card.id] || null);
  useEffect(() => {
    let active = true;
    if (!thumbCache[card.id] && card.hasPhotoFront) {
      window.storage.get(`img:${card.id}:front`, false).then((r) => {
        if (r && r.value) {
          thumbCache[card.id] = r.value;
          if (active) setUrl(r.value);
        }
      }).catch(() => {});
    }
    return () => { active = false; };
  }, [card.id, card.hasPhotoFront]);
  return url;
}

function fileToResizedDataUrl(file, maxDim = 900, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round(height * (maxDim / width)); width = maxDim; }
          else { width = Math.round(width * (maxDim / height)); height = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Could not read image'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

async function extractCardInfo(dataUrl) {
  const mediaType = dataUrl.substring(5, dataUrl.indexOf(';'));
  const base64 = dataUrl.split(',')[1];
  const response = await fetch(ANTHROPIC_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: 'Identify this trading card from the photo. Return ONLY a raw JSON object, no markdown fences, no explanation, with exactly these keys: name, cardType, setName, cardNumber, rarity, language, manufacturingInfo. Use an empty string for any field you cannot determine with confidence. Do not guess condition or grading - leave those out entirely.' },
        ],
      }],
    }),
  });
  const data = await response.json();
  const text = (data.content || []).map((b) => b.text || '').join('').trim();
  const clean = text.replace(/^```json/i, '').replace(/```$/, '').trim();
  return JSON.parse(clean);
}

function Field({ label, children }) {
  return (
    <label className="block min-w-0">
      <span className="block text-xs font-medium text-stone-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

const inputCls = "w-full min-w-0 h-9 px-3 rounded-md border border-stone-300 bg-white text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500";
const selectCls = inputCls + " appearance-none";
const textareaCls = "w-full min-w-0 px-3 py-2 rounded-md border border-stone-300 bg-white text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500";

function Section({ title, children }) {
  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-stone-800 mb-3 pb-1 border-b border-stone-200">{title}</h3>
      <div className="grid grid-cols-2 gap-3 min-w-0">{children}</div>
    </div>
  );
}

export default function App() {
  const [cards, setCards] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState('inventory');
  const [addStep, setAddStep] = useState(null); // null | 'choice' | 'scan'
  const [editing, setEditing] = useState(null);
  const [editingIsNew, setEditingIsNew] = useState(false);
  const [initialPhotoFront, setInitialPhotoFront] = useState(null);
  const [detail, setDetail] = useState(null);
  const [search, setSearch] = useState('');
  const [selectedSet, setSelectedSet] = useState(null);
  const [error, setError] = useState('');
  const [nextInvNumber, setNextInvNumber] = useState(1);

  useEffect(() => {
    (async () => {
      let list = [];
      let hadExistingData = false;
      try {
        const res = await window.storage.get('inventory', false);
        if (res && res.value) {
          list = JSON.parse(res.value);
          hadExistingData = true;
        }
      } catch (e) {}

      if (!hadExistingData) {
        list = sampleCards();
      }

      let counter = 1;
      try {
        const c = await window.storage.get('nextInvNumber', false);
        if (c && c.value) counter = Number(c.value) || 1;
      } catch (e) {}

      let assignedNew = false;
      const migrated = list.map((c) => {
        let merged = {
          ...emptyCard(),
          ...c,
          status: c.status === 'Sold' ? 'Sold - not shipped' : c.status === 'Delisted' ? 'Cancelled / Delisted' : (c.status || 'In inventory (no listing info)'),
        };
        if (merged.status === 'In inventory') {
          merged.status = (merged.listingTitle || merged.description) ? 'In inventory (ready to list)' : 'In inventory (no listing info)';
        }
        if (!merged.inventoryNumber) {
          merged.inventoryNumber = formatInv(counter);
          counter += 1;
          assignedNew = true;
        }
        return merged;
      });

      setCards(migrated);
      setNextInvNumber(counter);
      setLoaded(true);
      if (assignedNew) {
        try { await window.storage.set('nextInvNumber', String(counter), false); } catch (e) {}
      }
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    (async () => {
      try {
        const result = await window.storage.set('inventory', JSON.stringify(cards), false);
        setError(result ? '' : 'Could not save — your changes may not persist.');
      } catch (e) {
        setError('Could not save — your changes may not persist.');
      }
    })();
  }, [cards, loaded]);

  useEffect(() => {
    if (!loaded) return;
    (async () => { try { await window.storage.set('nextInvNumber', String(nextInvNumber), false); } catch (e) {} })();
  }, [nextInvNumber, loaded]);


  const filtered = useMemo(() => {
    return cards.filter((c) => {
      if (search) {
        const s = search.toLowerCase();
        const hay = [c.name, c.setName, c.cardType, c.cardNumber, c.sku, c.inventoryNumber].join(' ').toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [cards, search]);

  const grouped = useMemo(() => {
    return STATUS.map((s) => ({ status: s, cards: filtered.filter((c) => c.status === s) })).filter((g) => g.cards.length > 0);
  }, [filtered]);

  const stats = useMemo(() => {
    const totalCost = cards.reduce((a, c) => a + num(c.purchasePrice), 0);
    const totalValue = cards.reduce((a, c) => {
      if (isPostSale(c.status)) return a + num(c.soldPrice);
      return a + (num(c.comparablePrice) || num(c.buyItNowPrice) || num(c.purchasePrice));
    }, 0);
    return { count: cards.length, totalCost, totalValue, profit: totalValue - totalCost };
  }, [cards]);

  const sets = useMemo(() => {
    const map = {};
    cards.forEach((c) => {
      const key = c.setName || 'Unassigned';
      if (!map[key]) map[key] = { name: key, count: 0, value: 0, total: null };
      map[key].count += 1;
      map[key].value += isPostSale(c.status) ? num(c.soldPrice) : (num(c.comparablePrice) || num(c.buyItNowPrice) || num(c.purchasePrice));
      const parsed = parseCardNumber(c.cardNumber);
      if (parsed && (!map[key].total || parsed.total > map[key].total)) map[key].total = parsed.total;
    });
    return Object.values(map).sort((a, b) => b.count - a.count);
  }, [cards]);

  function addSlotToSet(setName, cardNumber) {
    const sample = cards.find((c) => (c.setName || 'Unassigned') === setName);
    setEditing({ ...emptyCard(), setName: setName === 'Unassigned' ? '' : setName, cardNumber, cardType: sample ? sample.cardType : '' });
    setEditingIsNew(true);
    setInitialPhotoFront(null);
  }

  function saveCard(card, isNewCard) {
    let finalCard = card;
    if (isNewCard && !card.inventoryNumber) {
      finalCard = { ...card, inventoryNumber: formatInv(nextInvNumber) };
      setNextInvNumber((n) => n + 1);
    }
    setCards((prev) => {
      const exists = prev.some((c) => c.id === finalCard.id);
      return exists ? prev.map((c) => (c.id === finalCard.id ? finalCard : c)) : [finalCard, ...prev];
    });
    setEditing(null);
    setInitialPhotoFront(null);
    setDetail(isNewCard ? null : finalCard.id);
  }

  async function bulkAddCards(items) {
    let counter = nextInvNumber;
    const newCards = [];
    for (const item of items) {
      const card = { ...emptyCard(), ...item.extracted, id: item.id, inventoryNumber: formatInv(counter) };
      counter += 1;
      if (item.dataUrl) {
        try { await window.storage.set(`img:${item.id}:front`, item.dataUrl, false); card.hasPhotoFront = true; } catch (e) {}
      }
      newCards.push(card);
    }
    setCards((prev) => [...newCards, ...prev]);
    setNextInvNumber(counter);
    setAddStep(null);
  }

  async function deleteCard(id) {
    setCards((prev) => prev.filter((c) => c.id !== id));
    setDetail(null);
    setEditing(null);
    try { await window.storage.delete(`img:${id}:front`, false); } catch (e) {}
    try { await window.storage.delete(`img:${id}:back`, false); } catch (e) {}
  }

  function updateCard(patch) {
    setCards((prev) => prev.map((c) => (c.id === patch.id ? patch : c)));
  }

  function advanceCard(id) {
    setCards((prev) => prev.map((c) => (c.id === id ? applyAdvance(c) : c)));
  }

  if (addStep === 'mode') {
    return (
      <AddModeScreen
        onCancel={() => setAddStep(null)}
        onSingle={() => setAddStep('choice')}
        onBulk={() => setAddStep('bulk')}
      />
    );
  }

  if (addStep === 'choice') {
    return (
      <AddChoiceScreen
        onCancel={() => setAddStep('mode')}
        onManual={() => { setAddStep(null); setEditing(emptyCard()); setEditingIsNew(true); setInitialPhotoFront(null); }}
        onScan={() => setAddStep('scan')}
      />
    );
  }

  if (addStep === 'scan') {
    return (
      <ScanScreen
        cards={cards}
        onCancel={() => setAddStep('choice')}
        onSkip={(pending) => { setAddStep(null); setEditing(emptyCard()); setEditingIsNew(true); setInitialPhotoFront(pending || null); }}
        onExtracted={(extracted, dataUrl) => {
          setAddStep(null);
          setEditing({ ...emptyCard(), ...sanitizeExtracted(extracted) });
          setEditingIsNew(true);
          setInitialPhotoFront(dataUrl);
        }}
      />
    );
  }

  if (addStep === 'bulk') {
    return (
      <BulkAddScreen
        cards={cards}
        onCancel={() => setAddStep('mode')}
        onImport={bulkAddCards}
      />
    );
  }

  if (editing) {
    return (
      <EditForm
        card={editing}
        isNew={editingIsNew}
        initialPhotoFront={initialPhotoFront}
        existingCards={cards}
        onCancel={() => { setEditing(null); setInitialPhotoFront(null); }}
        onSave={saveCard}
      />
    );
  }

  if (detail) {
    const card = cards.find((c) => c.id === detail);
    if (card) return <DetailView card={card} onBack={() => setDetail(null)} onEdit={() => { setEditing(card); setEditingIsNew(false); }} onDelete={() => deleteCard(card.id)} onUpdate={updateCard} onAdvance={() => advanceCard(card.id)} />;
  }

  return (
    <div className="min-h-screen bg-stone-50 font-sans overflow-x-hidden">
      <div className="max-w-2xl mx-auto px-4 pb-24">
        <header className="pt-6 pb-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-stone-900">Card inventory</h1>
            <p className="text-sm text-stone-500">{stats.count} card{stats.count === 1 ? '' : 's'} tracked</p>
          </div>
          <button onClick={() => setAddStep('mode')} className="flex items-center gap-1.5 h-10 px-4 rounded-md bg-stone-900 text-white text-sm font-medium active:scale-95 transition">
            <Plus size={16} /> Add item
          </button>
        </header>

        {error && <div className="mb-4 px-3 py-2 rounded-md bg-red-50 text-red-700 text-xs border border-red-200">{error}</div>}

        <div className="grid grid-cols-2 gap-3 mb-5">
          <StatCard label="Total cost basis" value={money(stats.totalCost)} />
          <StatCard label="Est. current value" value={money(stats.totalValue)} />
          <StatCard label="Unrealized profit" value={money(stats.profit)} tone={stats.profit > 0 ? 'text-emerald-700' : stats.profit < 0 ? 'text-red-600' : 'text-stone-900'} />
          <StatCard label="Distinct sets" value={sets.length} />
        </div>

        <div className="flex gap-2 mb-4">
          <button onClick={() => setView('inventory')} className={`flex items-center gap-1.5 h-9 px-3 rounded-md text-sm font-medium border ${view === 'inventory' ? 'bg-stone-900 text-white border-stone-900' : 'bg-white text-stone-600 border-stone-300'}`}>
            <ListIcon size={14} /> Inventory
          </button>
          <button onClick={() => setView('sets')} className={`flex items-center gap-1.5 h-9 px-3 rounded-md text-sm font-medium border ${view === 'sets' ? 'bg-stone-900 text-white border-stone-900' : 'bg-white text-stone-600 border-stone-300'}`}>
            <LayoutGrid size={14} /> By set
          </button>
          <button onClick={() => setView('ask')} className={`flex items-center gap-1.5 h-9 px-3 rounded-md text-sm font-medium border ${view === 'ask' ? 'bg-stone-900 text-white border-stone-900' : 'bg-white text-stone-600 border-stone-300'}`}>
            <Bot size={14} /> Agent
          </button>
        </div>

        {view === 'inventory' && (
          <>
            <div className="relative mb-4">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, set, SKU..." className="w-full h-9 pl-9 pr-3 rounded-md border border-stone-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>

            {grouped.length === 0 ? (
              <EmptyState hasCards={cards.length > 0} onAdd={() => setAddStep('mode')} />
            ) : (
              <div className="space-y-6">
                {grouped.map((g) => (
                  <StatusSection key={g.status} status={g.status} cardsInStatus={g.cards} onOpen={(id) => setDetail(id)} />
                ))}
              </div>
            )}
          </>
        )}

        {view === 'sets' && (
          selectedSet ? (
            <SetBinderView
              setName={selectedSet}
              cardsInSet={cards.filter((c) => (c.setName || 'Unassigned') === selectedSet)}
              onBack={() => setSelectedSet(null)}
              onOpen={(id) => setDetail(id)}
              onAddSlot={(setName, cardNumber) => addSlotToSet(setName, cardNumber)}
            />
          ) : (
            <div className="space-y-2">
              {sets.length === 0 ? (
                <EmptyState hasCards={false} onAdd={() => setAddStep('mode')} />
              ) : (
                sets.map((s) => (
                  <SetCard key={s.name} set={s} cardsInSet={cards.filter((c) => (c.setName || 'Unassigned') === s.name)} onClick={() => setSelectedSet(s.name)} />
                ))
              )}
            </div>
          )
        )}

        {view === 'ask' && <ChatPanel cards={cards} stats={stats} sets={sets} onCardsChange={setCards} />}
      </div>
    </div>
  );
}

function AddModeScreen({ onSingle, onBulk, onCancel }) {
  return (
    <div className="min-h-screen bg-stone-50 font-sans overflow-x-hidden">
      <div className="max-w-2xl mx-auto px-4 pb-24">
        <header className="pt-6 pb-4">
          <button onClick={onCancel} className="flex items-center gap-1.5 text-sm text-stone-600"><ArrowLeft size={16} /> Cancel</button>
        </header>
        <h1 className="text-xl font-semibold text-stone-900 mb-1">Add item</h1>
        <p className="text-sm text-stone-500 mb-6">Add one card, or add several at once.</p>
        <div className="space-y-3">
          <button onClick={onSingle} className="w-full flex items-center gap-3 bg-white rounded-lg border border-stone-200 px-4 py-4 text-left active:bg-stone-50">
            <div className="w-10 h-10 rounded-md bg-stone-100 flex items-center justify-center shrink-0"><Plus size={18} className="text-stone-700" /></div>
            <div>
              <p className="text-sm font-medium text-stone-900">Add a single item</p>
              <p className="text-xs text-stone-500">Scan a photo or enter the details yourself</p>
            </div>
          </button>
          <button onClick={onBulk} className="w-full flex items-center gap-3 bg-white rounded-lg border border-stone-200 px-4 py-4 text-left active:bg-stone-50">
            <div className="w-10 h-10 rounded-md bg-amber-100 flex items-center justify-center shrink-0"><LayoutGrid size={18} className="text-amber-700" /></div>
            <div>
              <p className="text-sm font-medium text-stone-900">Bulk add</p>
              <p className="text-xs text-stone-500">Upload several photos from your camera roll at once</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

function AddChoiceScreen({ onManual, onScan, onCancel }) {
  return (
    <div className="min-h-screen bg-stone-50 font-sans overflow-x-hidden">
      <div className="max-w-2xl mx-auto px-4 pb-24">
        <header className="pt-6 pb-4">
          <button onClick={onCancel} className="flex items-center gap-1.5 text-sm text-stone-600"><ArrowLeft size={16} /> Cancel</button>
        </header>
        <h1 className="text-xl font-semibold text-stone-900 mb-1">Add a card</h1>
        <p className="text-sm text-stone-500 mb-6">How do you want to enter this card?</p>
        <div className="space-y-3">
          <button onClick={onScan} className="w-full flex items-center gap-3 bg-white rounded-lg border border-stone-200 px-4 py-4 text-left active:bg-stone-50">
            <div className="w-10 h-10 rounded-md bg-amber-100 flex items-center justify-center shrink-0"><Camera size={18} className="text-amber-700" /></div>
            <div>
              <p className="text-sm font-medium text-stone-900">Scan a photo</p>
              <p className="text-xs text-stone-500">Upload a photo and let the assistant fill in the details</p>
            </div>
          </button>
          <button onClick={onManual} className="w-full flex items-center gap-3 bg-white rounded-lg border border-stone-200 px-4 py-4 text-left active:bg-stone-50">
            <div className="w-10 h-10 rounded-md bg-stone-100 flex items-center justify-center shrink-0"><Pencil size={18} className="text-stone-700" /></div>
            <div>
              <p className="text-sm font-medium text-stone-900">Enter manually</p>
              <p className="text-xs text-stone-500">Fill in the card details yourself</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

function ScanScreen({ cards, onCancel, onExtracted, onSkip }) {
  const [preview, setPreview] = useState(null);
  const [pending, setPending] = useState(null);
  const [status, setStatus] = useState('idle');
  const [err, setErr] = useState('');
  const [duplicate, setDuplicate] = useState(null);
  const [extractedInfo, setExtractedInfo] = useState(null);

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const dataUrl = await fileToResizedDataUrl(file, 1100, 0.8);
      setPreview(dataUrl);
      setPending(dataUrl);
      setStatus('analyzing');
      setErr('');
      setDuplicate(null);
      const extracted = await extractCardInfo(dataUrl);
      const clean = sanitizeExtracted(extracted);
      const dup = findDuplicateCard(cards, clean);
      if (dup) {
        setExtractedInfo({ extracted, dataUrl });
        setDuplicate(dup);
        setStatus('duplicate');
      } else {
        onExtracted(extracted, dataUrl);
      }
    } catch (e2) {
      setStatus('error');
      setErr("Couldn't read the card from that photo. Try another photo, or enter the details yourself.");
    }
  }

  return (
    <div className="min-h-screen bg-stone-50 font-sans overflow-x-hidden">
      <div className="max-w-2xl mx-auto px-4 pb-24">
        <header className="pt-6 pb-4">
          <button onClick={onCancel} className="flex items-center gap-1.5 text-sm text-stone-600"><ArrowLeft size={16} /> Cancel</button>
        </header>
        <h1 className="text-xl font-semibold text-stone-900 mb-1">Scan a card</h1>
        <p className="text-sm text-stone-500 mb-6">Upload a clear photo of the front of the card.</p>

        {preview && <img src={preview} alt="" className="w-40 h-56 object-cover rounded-md border border-stone-200 mb-4" />}

        {status === 'analyzing' && (
          <div className="flex items-center gap-2 text-sm text-stone-500 mb-4">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" /> Reading the card...
          </div>
        )}

        {status === 'error' && <div className="mb-4 px-3 py-2 rounded-md bg-red-50 text-red-700 text-xs border border-red-200">{err}</div>}

        {status === 'duplicate' && duplicate && (
          <div className="mb-4 p-3 rounded-md bg-amber-50 border border-amber-200">
            <p className="text-sm text-amber-900 mb-3">
              You already have <span className="font-medium">{duplicate.name}</span> ({duplicate.inventoryNumber}) in your {duplicate.setName || 'inventory'}. Is this a duplicate you accidentally scanned twice, or do you actually have two of this card?
            </p>
            <div className="flex gap-2">
              <button onClick={() => onExtracted(extractedInfo.extracted, extractedInfo.dataUrl)} className="flex-1 h-9 rounded-md bg-stone-900 text-white text-xs font-medium">Add anyway</button>
              <button onClick={() => { setStatus('idle'); setPreview(null); setPending(null); setDuplicate(null); }} className="flex-1 h-9 rounded-md border border-stone-300 bg-white text-xs font-medium text-stone-700">Don't add</button>
            </div>
          </div>
        )}

        {status !== 'analyzing' && status !== 'duplicate' && (
          <label className="w-full flex items-center justify-center gap-2 h-11 rounded-md bg-stone-900 text-white text-sm font-medium cursor-pointer">
            <Camera size={16} /> {preview ? 'Try another photo' : 'Choose photo'}
            <input type="file" accept="image/*" className="hidden" onChange={handleFile} />
          </label>
        )}

        {status !== 'duplicate' && (
          <button onClick={() => onSkip(pending)} className="w-full mt-3 h-11 rounded-md border border-stone-300 text-sm font-medium text-stone-700">
            Enter details manually instead
          </button>
        )}
      </div>
    </div>
  );
}

function BulkAddScreen({ cards, onCancel, onImport }) {
  const [items, setItems] = useState([]);
  const [importing, setImporting] = useState(false);

  async function handleFiles(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const newItems = files.map((f) => ({ id: crypto.randomUUID(), file: f, dataUrl: null, status: 'analyzing', extracted: null, duplicate: null, include: true }));
    setItems((prev) => [...prev, ...newItems]);
    for (const item of newItems) {
      try {
        const dataUrl = await fileToResizedDataUrl(item.file, 1100, 0.8);
        setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, dataUrl } : it)));
        const extracted = await extractCardInfo(dataUrl);
        const clean = sanitizeExtracted(extracted);
        const dup = findDuplicateCard(cards, clean);
        setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, status: 'done', extracted: clean, duplicate: dup, include: !dup } : it)));
      } catch (err) {
        setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, status: 'error', include: false } : it)));
      }
    }
  }

  function toggleInclude(id) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, include: !it.include } : it)));
  }

  function removeItem(id) {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  async function handleImport() {
    const toAdd = items.filter((it) => it.status === 'done' && it.include);
    if (toAdd.length === 0) return;
    setImporting(true);
    await onImport(toAdd);
    setImporting(false);
  }

  const analyzing = items.some((it) => it.status === 'analyzing');
  const includedCount = items.filter((it) => it.status === 'done' && it.include).length;

  return (
    <div className="min-h-screen bg-stone-50 font-sans overflow-x-hidden">
      <div className="max-w-2xl mx-auto px-4 pb-28">
        <header className="pt-6 pb-4">
          <button onClick={onCancel} className="flex items-center gap-1.5 text-sm text-stone-600"><ArrowLeft size={16} /> Cancel</button>
        </header>
        <h1 className="text-xl font-semibold text-stone-900 mb-1">Bulk add</h1>
        <p className="text-sm text-stone-500 mb-6">Choose several photos — one card front per photo. Each becomes its own item in your inventory.</p>

        <label className="w-full flex items-center justify-center gap-2 h-11 rounded-md bg-stone-900 text-white text-sm font-medium cursor-pointer mb-5">
          <Camera size={16} /> {items.length === 0 ? 'Choose photos' : 'Add more photos'}
          <input type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} />
        </label>

        {items.length > 0 && (
          <div className="space-y-2 mb-4">
            {items.map((it) => (
              <div key={it.id} className="bg-white rounded-lg border border-stone-200 p-3">
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-md bg-stone-100 overflow-hidden shrink-0 flex items-center justify-center">
                    {it.dataUrl ? <img src={it.dataUrl} alt="" className="w-full h-full object-cover" /> : <Camera size={16} className="text-stone-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    {it.status === 'analyzing' && <p className="text-sm text-stone-500">Reading the card...</p>}
                    {it.status === 'error' && <p className="text-sm text-red-600">Couldn't read this card</p>}
                    {it.status === 'done' && (
                      <>
                        <p className="text-sm font-medium text-stone-900 truncate">{it.extracted.name || 'Unnamed card'}</p>
                        <p className="text-xs text-stone-500 truncate">{[it.extracted.setName, it.extracted.cardNumber].filter(Boolean).join(' · ')}</p>
                      </>
                    )}
                  </div>
                  {it.status === 'done' && !it.duplicate && (
                    <label className="flex items-center gap-1.5 text-xs text-stone-600 shrink-0">
                      <input type="checkbox" checked={it.include} onChange={() => toggleInclude(it.id)} />
                      Include
                    </label>
                  )}
                  <button onClick={() => removeItem(it.id)} className="w-7 h-7 rounded-full border border-stone-300 flex items-center justify-center shrink-0" aria-label="Remove">
                    <X size={13} />
                  </button>
                </div>
                {it.status === 'done' && it.duplicate && (
                  <div className="mt-2 p-2 rounded-md bg-amber-50 border border-amber-200">
                    <p className="text-xs text-amber-900 mb-2">
                      Matches existing <span className="font-medium">{it.duplicate.name}</span> ({it.duplicate.inventoryNumber}). Duplicate scan, or do you have two?
                    </p>
                    <div className="flex gap-2">
                      <button onClick={() => setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, include: true } : p)))} className={`flex-1 h-7 rounded-md text-xs font-medium ${it.include ? 'bg-stone-900 text-white' : 'border border-stone-300 bg-white text-stone-700'}`}>Add anyway</button>
                      <button onClick={() => setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, include: false } : p)))} className={`flex-1 h-7 rounded-md text-xs font-medium ${!it.include ? 'bg-stone-900 text-white' : 'border border-stone-300 bg-white text-stone-700'}`}>Don't add</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {items.length > 0 && (
          <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-stone-200 p-4">
            <div className="max-w-2xl mx-auto">
              <button
                onClick={handleImport}
                disabled={analyzing || importing || includedCount === 0}
                className="w-full h-11 rounded-md bg-stone-900 text-white text-sm font-medium disabled:opacity-50"
              >
                {importing ? 'Adding...' : analyzing ? 'Reading cards...' : `Add ${includedCount} item${includedCount === 1 ? '' : 's'} to inventory`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, tone }) {
  return (
    <div className="bg-white rounded-lg border border-stone-200 px-4 py-3">
      <p className="text-xs text-stone-500 mb-1">{label}</p>
      <p className={`text-lg font-semibold ${tone || 'text-stone-900'}`}>{value}</p>
    </div>
  );
}

function EmptyState({ hasCards, onAdd }) {
  return (
    <div className="text-center py-16 px-4 bg-white rounded-lg border border-dashed border-stone-300">
      <p className="text-sm font-medium text-stone-700 mb-1">{hasCards ? 'No cards match your search' : 'No cards yet'}</p>
      <p className="text-sm text-stone-500 mb-4">{hasCards ? 'Try a different search term.' : 'Add your first card to start tracking your collection.'}</p>
      {!hasCards && (
        <button onClick={onAdd} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-stone-900 text-white text-sm font-medium">
          <Plus size={14} /> Add item
        </button>
      )}
    </div>
  );
}

function SetPreviewTile({ card }) {
  const thumb = useThumbnail(card || {});
  if (!card) return <div className="bg-stone-100" />;
  return thumb ? <img src={thumb} alt="" className="w-full h-full object-cover" /> : <div className="bg-stone-200" />;
}

function SetCard({ set, cardsInSet, onClick }) {
  const previewCards = cardsInSet.slice(0, 4);
  const pct = set.total ? Math.min(100, (set.count / set.total) * 100) : null;
  return (
    <button onClick={onClick} className="w-full bg-white rounded-lg border border-stone-200 p-3 text-left active:bg-stone-50">
      <div className="flex items-center gap-3">
        <div className="grid grid-cols-2 gap-0.5 w-14 h-14 rounded-md overflow-hidden bg-stone-100 shrink-0">
          {previewCards.length === 0 ? (
            <div className="col-span-2 row-span-2 flex items-center justify-center"><LayoutGrid size={16} className="text-stone-300" /></div>
          ) : (
            Array.from({ length: 4 }).map((_, i) => <SetPreviewTile key={i} card={previewCards[i] || null} />)
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-stone-900 truncate">{set.name}</p>
          <p className="text-xs text-stone-500">{set.total ? `${set.count} of ${set.total} collected` : `${set.count} card${set.count === 1 ? '' : 's'}`}</p>
          {pct !== null && (
            <div className="h-1.5 bg-stone-100 rounded-full mt-1.5 overflow-hidden">
              <div className="h-full bg-amber-500 rounded-full" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold text-stone-900">{money(set.value)}</p>
        </div>
        <ChevronRight size={16} className="text-stone-300 shrink-0" />
      </div>
    </button>
  );
}

function OwnedTile({ card, onOpen }) {
  const thumb = useThumbnail(card);
  const value = isPostSale(card.status) ? num(card.soldPrice) : (num(card.comparablePrice) || num(card.buyItNowPrice) || num(card.purchasePrice));
  return (
    <button onClick={() => onOpen(card.id)} className="text-left">
      <div className="aspect-[2/3] rounded-md overflow-hidden border border-stone-200 bg-stone-100">
        {thumb ? (
          <img src={thumb} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center"><ImageIcon size={20} className="text-stone-400" /></div>
        )}
      </div>
      <p className="text-xs font-medium text-stone-800 mt-1.5 truncate">{card.name || 'Untitled'}</p>
      <p className="text-xs text-stone-500">{value > 0 ? shortMoney(value) : '—'}</p>
    </button>
  );
}

function SlotTile({ slot, checklistEntry, onOpen, onAddSlot }) {
  if (slot.card) return <OwnedTile card={slot.card} onOpen={onOpen} />;
  const name = checklistEntry && checklistEntry.name ? checklistEntry.name : `#${slot.num}`;
  const price = checklistEntry && checklistEntry.price ? checklistEntry.price : null;
  return (
    <button onClick={onAddSlot} className="text-left opacity-50">
      <div className="aspect-[2/3] rounded-md border border-dashed border-stone-300 bg-stone-100 flex flex-col items-center justify-center text-stone-400">
        <span className="text-sm font-medium">{slot.num}</span>
        <Plus size={14} className="mt-1" />
      </div>
      <p className="text-xs font-medium text-stone-500 mt-1.5 truncate">{name}</p>
      <p className="text-xs text-stone-500">{price ? shortMoney(price) : '—'}</p>
    </button>
  );
}

function SetBinderView({ setName, cardsInSet, onBack, onOpen, onAddSlot }) {
  let total = null;
  cardsInSet.forEach((c) => {
    const p = parseCardNumber(c.cardNumber);
    if (p && (!total || p.total > total)) total = p.total;
  });

  const totalValue = cardsInSet.reduce((a, c) => a + (isPostSale(c.status) ? num(c.soldPrice) : (num(c.comparablePrice) || num(c.buyItNowPrice) || num(c.purchasePrice))), 0);

  let slots = null;
  if (total) {
    const byNum = {};
    cardsInSet.forEach((c) => {
      const p = parseCardNumber(c.cardNumber);
      if (p && !byNum[p.num]) byNum[p.num] = c;
    });
    slots = Array.from({ length: total }, (_, i) => ({ num: i + 1, card: byNum[i + 1] || null }));
  }

  const [checklist, setChecklist] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [loadingChecklist, setLoadingChecklist] = useState(false);
  const [checklistError, setChecklistError] = useState('');

  const STALE_MS = 7 * 24 * 60 * 60 * 1000;

  async function refreshChecklist(silent) {
    if (!total) return;
    if (!silent) { setLoadingChecklist(true); setChecklistError(''); }
    try {
      const result = await fetchSetChecklist(setName, total, cardsInSet[0] && cardsInSet[0].cardType);
      const now = new Date().toISOString();
      setChecklist(result);
      setFetchedAt(now);
      try { await window.storage.set(`setChecklist:${setName}`, JSON.stringify({ fetchedAt: now, total, cards: result }), false); } catch (e) {}
    } catch (e) {
      if (!silent) setChecklistError("Couldn't fetch the checklist right now. Try again.");
    }
    if (!silent) setLoadingChecklist(false);
  }

  useEffect(() => {
    let active = true;
    (async () => {
      let hadCache = false;
      try {
        const res = await window.storage.get(`setChecklist:${setName}`, false);
        if (res && res.value) {
          const parsed = JSON.parse(res.value);
          if (active) { setChecklist(parsed.cards); setFetchedAt(parsed.fetchedAt); }
          hadCache = true;
          const age = Date.now() - new Date(parsed.fetchedAt).getTime();
          if (age > STALE_MS && total) refreshChecklist(true);
        }
      } catch (e) {}
      if (!hadCache && total) refreshChecklist(false);
    })();
    return () => { active = false; };
  }, [setName, total]);

  const checklistMap = useMemo(() => {
    const m = {};
    (checklist || []).forEach((c) => { if (c && c.num) m[c.num] = c; });
    return m;
  }, [checklist]);

  const isStale = fetchedAt && (Date.now() - new Date(fetchedAt).getTime() > STALE_MS);

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-stone-600 mb-4"><ArrowLeft size={16} /> All sets</button>
      <h2 className="text-lg font-semibold text-stone-900 mb-1">{setName}</h2>
      <p className="text-sm text-stone-500 mb-3">
        {total ? `${cardsInSet.length} of ${total} collected · ` : `${cardsInSet.length} card${cardsInSet.length === 1 ? '' : 's'} · `}
        {money(totalValue)} total
      </p>
      {total && (
        <div className="h-2 bg-white border border-stone-200 rounded-full mb-3 overflow-hidden">
          <div className="h-full bg-amber-500" style={{ width: `${Math.min(100, (cardsInSet.length / total) * 100)}%` }} />
        </div>
      )}

      {total && (
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-stone-400">
            {loadingChecklist ? 'Researching missing cards & prices...' : fetchedAt ? `Checklist updated ${formatTimestamp(fetchedAt)}${isStale ? ' — refreshing soon' : ''}` : ''}
          </p>
          <button onClick={() => refreshChecklist(false)} disabled={loadingChecklist} className="flex items-center gap-1 text-xs font-medium text-stone-600 disabled:opacity-50 shrink-0">
            <RefreshCw size={12} className={loadingChecklist ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      )}
      {checklistError && <p className="text-xs text-red-600 mb-3">{checklistError}</p>}

      <div className="grid grid-cols-3 gap-3">
        {slots
          ? slots.map((slot) => <SlotTile key={slot.num} slot={slot} checklistEntry={checklistMap[slot.num]} onOpen={onOpen} onAddSlot={() => onAddSlot(setName, `${slot.num}/${total}`)} />)
          : cardsInSet.map((c) => <OwnedTile key={c.id} card={c} onOpen={onOpen} />)}
      </div>

      {!slots && (
        <p className="text-xs text-stone-400 mt-4">Add a card number like "4/102" to any card in this set to see empty slots for what you're missing.</p>
      )}
      {slots && (
        <p className="text-xs text-stone-400 mt-4">Missing-card names and prices are AI-researched from the web, not a single pricing source — treat them as approximate.</p>
      )}
    </div>
  );
}

function StatusSection({ status, cardsInStatus, onOpen }) {
  const [expanded, setExpanded] = useState(false);
  const cap = 20;
  const visible = expanded ? cardsInStatus : cardsInStatus.slice(0, cap);
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${STATUS_STYLE[status]}`}>{status}</span>
          <span className="text-xs text-stone-400">{cardsInStatus.length}</span>
        </div>
      </div>
      <div className="space-y-2">
        {visible.map((c) => <CardRow key={c.id} card={c} onClick={() => onOpen(c.id)} />)}
      </div>
      {cardsInStatus.length > cap && (
        <button onClick={() => setExpanded((v) => !v)} className="w-full h-9 mt-2 rounded-md border border-stone-300 bg-white text-xs font-medium text-stone-600">
          {expanded ? 'Show less' : `Show all ${cardsInStatus.length}`}
        </button>
      )}
    </div>
  );
}

function CardRow({ card, onClick }) {
  const thumb = useThumbnail(card);
  const cost = num(card.purchasePrice);
  const currentPrice = num(card.buyItNowPrice) || num(card.comparablePrice) || cost;
  const value = isPostSale(card.status) ? num(card.soldPrice) : currentPrice;
  const history = card.priceHistory || [];
  const priceChange = history.length >= 2 ? num(history[history.length - 1].price) - num(history[history.length - 2].price) : null;
  const action = NEXT_ACTION[card.status];

  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 bg-white rounded-lg border border-stone-200 px-3 py-3 text-left active:bg-stone-50">
      <div className="w-12 h-12 rounded-md bg-stone-100 overflow-hidden shrink-0 flex items-center justify-center">
        {thumb ? (
          <img src={thumb} alt="" className="w-full h-full object-cover" onError={(e) => { e.target.style.display = 'none'; }} />
        ) : (
          <ImageIcon size={16} className="text-stone-400" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-stone-900 truncate">{card.name || 'Untitled card'}</p>
        <p className="text-xs text-stone-500 truncate">{[card.setName, card.cardNumber].filter(Boolean).join(' · ') || card.cardType}</p>
        {card.inventoryNumber && <p className="text-[11px] font-mono text-stone-400 mt-0.5">{card.inventoryNumber}</p>}
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-semibold text-stone-900">{money(value)}</p>
        {priceChange !== null && priceChange !== 0 && (
          <p className={`text-[11px] font-medium ${priceChange > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
            {priceChange > 0 ? '▲' : '▼'} {money(Math.abs(priceChange))}
          </p>
        )}
        {action && <p className="text-[11px] text-stone-400 mt-0.5">Tap to {action.label.toLowerCase()}</p>}
      </div>
      <ChevronRight size={16} className="text-stone-300 shrink-0" />
    </button>
  );
}

function DetailRow({ label, value }) {
  if (value === '' || value === undefined || value === null || value === false) return null;
  return (
    <div className="flex justify-between py-2 border-b border-stone-100 text-sm">
      <span className="text-stone-500">{label}</span>
      <span className="text-stone-900 font-medium text-right max-w-[60%] break-words">{String(value)}</span>
    </div>
  );
}

function computeFloor(card) {
  const floors = [];
  if (card.floorPrice) floors.push(num(card.floorPrice));
  if (card.floorPercentOfCost && card.purchasePrice) floors.push(num(card.purchasePrice) * (num(card.floorPercentOfCost) / 100));
  return floors.length ? Math.max(...floors) : 0;
}

function CollapsibleSection({ title, defaultOpen, badge, children }) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => { setOpen(defaultOpen); }, [defaultOpen]);
  return (
    <div className="mt-4 bg-white rounded-lg border border-stone-200 overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-stone-800">{title}</span>
          {badge}
        </div>
        <ChevronRight size={16} className={`text-stone-400 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && <div className="px-4 pb-4 pt-1 border-t border-stone-100">{children}</div>}
    </div>
  );
}

function DetailView({ card, onBack, onEdit, onDelete, onUpdate, onAdvance }) {
  const [frontUrl, setFrontUrl] = useState(card.photoFront || null);
  const [backUrl, setBackUrl] = useState(card.photoBack || null);
  const [pulling, setPulling] = useState(false);
  const [pullError, setPullError] = useState('');
  const [showGraph, setShowGraph] = useState(false);
  const [quickPrice, setQuickPrice] = useState(card.buyItNowPrice || '');
  const [autoNote, setAutoNote] = useState('');
  const [pricePrompt, setPricePrompt] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');
  const [copied, setCopied] = useState(false);

  async function handleGenerateListing() {
    setGenerating(true);
    setGenError('');
    try {
      const listing = await generateListingCopy(card);
      onUpdate(withAutoListingStatus({ ...card, listingTitle: listing.title, description: listing.description }));
    } catch (e) {
      setGenError("Couldn't generate listing copy right now. Try again.");
    }
    setGenerating(false);
  }

  async function handleCreateListing() {
    const text = `${card.listingTitle || card.name}\n\n${card.description || ''}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (e) {}
    window.open('https://www.ebay.com/sl/sell', '_blank', 'noopener,noreferrer');
    if (card.status === 'In inventory (ready to list)') onAdvance();
  }


  useEffect(() => { setQuickPrice(card.buyItNowPrice || ''); }, [card.id, card.buyItNowPrice]);

  useEffect(() => {
    let active = true;
    if (card.hasPhotoFront) {
      window.storage.get(`img:${card.id}:front`, false).then((r) => { if (active && r) setFrontUrl(r.value); }).catch(() => {});
    }
    if (card.hasPhotoBack) {
      window.storage.get(`img:${card.id}:back`, false).then((r) => { if (active && r) setBackUrl(r.value); }).catch(() => {});
    }
    return () => { active = false; };
  }, [card.id, card.hasPhotoFront, card.hasPhotoBack]);

  function saveQuickPrice() {
    if (quickPrice === '' || isNaN(Number(quickPrice)) || Number(quickPrice) === num(card.buyItNowPrice)) return;
    const today = new Date().toISOString().slice(0, 10);
    onUpdate({ ...card, buyItNowPrice: quickPrice, priceHistory: [...(card.priceHistory || []), { date: today, price: quickPrice }] });
  }

  function applyPricePrompt() {
    if (!pricePrompt) return;
    const newPrice = Math.round(Math.max(pricePrompt.newAvg, pricePrompt.floor) * 100) / 100;
    const today = new Date().toISOString().slice(0, 10);
    onUpdate({ ...card, buyItNowPrice: String(newPrice), priceHistory: [...(card.priceHistory || []), { date: today, price: String(newPrice) }] });
    setPricePrompt(null);
  }

  async function handlePullLive() {
    setPulling(true);
    setPullError('');
    setAutoNote('');
    setPricePrompt(null);
    try {
      const result = await fetchLiveComp(card);
      const now = new Date().toISOString();
      const newAvg = result.average;
      let patch = {
        ...card,
        comparablePrice: String(newAvg),
        lastPriceCheck: now,
        compHistory: [...(card.compHistory || []), { date: now, price: newAvg }],
      };
      const currentPrice = num(card.buyItNowPrice);
      if (currentPrice > 0) {
        const pctDiff = ((newAvg - currentPrice) / currentPrice) * 100;
        const up = num(card.autoAdjustUpPercent);
        const down = num(card.autoAdjustDownPercent);
        const floor = computeFloor(card);
        if (card.autoAdjustEnabled && up > 0 && pctDiff >= up) {
          const newPrice = Math.round(newAvg * 100) / 100;
          patch.buyItNowPrice = String(newPrice);
          patch.priceHistory = [...(card.priceHistory || []), { date: now.slice(0, 10), price: String(newPrice) }];
          setAutoNote(`Price auto-adjusted up to ${money(newPrice)} — comps rose ${pctDiff.toFixed(1)}%.`);
        } else if (card.autoAdjustEnabled && down > 0 && pctDiff <= -down) {
          const target = Math.max(newAvg, floor);
          const newPrice = Math.round(target * 100) / 100;
          patch.buyItNowPrice = String(newPrice);
          patch.priceHistory = [...(card.priceHistory || []), { date: now.slice(0, 10), price: String(newPrice) }];
          setAutoNote(`Price auto-adjusted down to ${money(newPrice)} — comps fell ${Math.abs(pctDiff).toFixed(1)}%.${target > newAvg ? ' Held at your price floor.' : ''}`);
        } else if (Math.abs(pctDiff) >= 1) {
          setPricePrompt({ newAvg, pctDiff, floor });
        }
      }
      onUpdate(patch);
    } catch (e) {
      setPullError("Couldn't pull a live price right now. Try again in a moment.");
    }
    setPulling(false);
  }

  const cost = num(card.purchasePrice);
  const value = isPostSale(card.status) ? num(card.soldPrice) : (num(card.comparablePrice) || num(card.buyItNowPrice) || cost);
  const netFees = num(card.shippingCost) + num(card.fees);
  const realizedProfit = isPostSale(card.status) ? num(card.soldPrice) - cost - netFees : null;
  const [changingStatus, setChangingStatus] = useState(false);
  const hasListingInfo = !!(card.listingTitle || card.description);
  const hasShippingInfo = !!(card.trackingNumber || card.buyerName || card.shippingCarrier);
  const [soldPriceInput, setSoldPriceInput] = useState(card.soldPrice || card.buyItNowPrice || '');
  const [soldDateInput, setSoldDateInput] = useState(card.soldDate || new Date().toISOString().slice(0, 10));

  function handleMarkSold() {
    const advanced = applyAdvance(card);
    onUpdate({ ...advanced, soldPrice: soldPriceInput || advanced.soldPrice, soldDate: soldDateInput || advanced.soldDate });
  }

  return (
    <div className="min-h-screen bg-stone-50 font-sans overflow-x-hidden">
      <div className="max-w-2xl mx-auto px-4 pb-24">
        <header className="pt-6 pb-4 flex items-center justify-between">
          <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-stone-600"><ArrowLeft size={16} /> Back</button>
          <div className="flex gap-2">
            <button onClick={onEdit} className="flex items-center gap-1.5 h-9 px-3 rounded-md border border-stone-300 bg-white text-sm font-medium text-stone-700"><Pencil size={14} /> Edit</button>
            <button onClick={() => { if (confirm('Delete this card? This cannot be undone.')) onDelete(); }} className="flex items-center gap-1.5 h-9 px-3 rounded-md border border-red-200 bg-white text-sm font-medium text-red-600"><Trash2 size={14} /></button>
          </div>
        </header>

        <h1 className="text-xl font-semibold text-stone-900">{card.name || 'Untitled card'}</h1>
        <p className="text-sm text-stone-500 mb-1">{[card.setName, card.cardNumber, card.cardType].filter(Boolean).join(' · ')}</p>
        {card.inventoryNumber && <p className="text-xs font-mono text-stone-400 mb-3">{card.inventoryNumber}</p>}

        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {changingStatus ? (
            <select
              autoFocus
              value={card.status}
              onChange={(e) => { onUpdate({ ...card, status: e.target.value }); setChangingStatus(false); }}
              onBlur={() => setChangingStatus(false)}
              className="text-xs font-medium px-2.5 py-1 rounded-full border border-stone-300 bg-white"
            >
              {STATUS.map((s) => <option key={s}>{s}</option>)}
            </select>
          ) : (
            <button onClick={() => setChangingStatus(true)} className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_STYLE[card.status]}`}>
              {card.status} <Pencil size={10} />
            </button>
          )}
        </div>

        <div className="bg-white rounded-lg border border-stone-200 p-4 mb-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-stone-500">Buy-it-now price</span>
            <button onClick={handlePullLive} disabled={pulling} className="flex items-center gap-1 text-xs font-medium text-stone-600 disabled:opacity-50">
              <RefreshCw size={12} className={pulling ? 'animate-spin' : ''} /> {pulling ? 'Pulling...' : 'Pull live comp'}
            </button>
          </div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl font-semibold text-stone-400">$</span>
            <input type="number" value={quickPrice} onChange={(e) => setQuickPrice(e.target.value)} className="flex-1 min-w-0 h-11 px-2 text-xl font-semibold border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500" />
          </div>
          {quickPrice !== '' && Number(quickPrice) !== num(card.buyItNowPrice) && !isNaN(Number(quickPrice)) && (
            <button onClick={saveQuickPrice} className="w-full h-10 rounded-md bg-stone-900 text-white text-sm font-medium mb-3">Save new price</button>
          )}

          {card.comparablePrice ? (
            <div className={`flex items-stretch gap-3 pt-3 ${quickPrice !== '' && Number(quickPrice) !== num(card.buyItNowPrice) ? '' : 'mt-2'} border-t border-stone-100`}>
              <div className="flex-1">
                <p className="text-xs text-stone-500 mb-0.5">Comps avg</p>
                <p className="text-xl font-semibold text-amber-700">{money(card.comparablePrice)}</p>
              </div>
              {card.buyItNowPrice && (() => {
                const d = num(card.comparablePrice) - num(card.buyItNowPrice);
                if (d === 0) return (
                  <div className="flex-1 text-right">
                    <p className="text-xs text-stone-500 mb-0.5">Vs. your price</p>
                    <p className="text-xl font-semibold text-stone-500">Even</p>
                  </div>
                );
                return (
                  <div className="flex-1 text-right">
                    <p className="text-xs text-stone-500 mb-0.5">{d > 0 ? 'Above' : 'Below'} your price</p>
                    <p className={`text-xl font-semibold ${d > 0 ? 'text-emerald-700' : 'text-red-600'}`}>{d > 0 ? '+' : ''}{money(d)}</p>
                  </div>
                );
              })()}
            </div>
          ) : (
            <p className="text-xs text-stone-400 mt-2 pt-3 border-t border-stone-100">No comp data yet — pull a live price to get started.</p>
          )}
          {card.lastPriceCheck && <p className="text-[11px] text-stone-400 mt-1">Pulled {formatTimestamp(card.lastPriceCheck)}</p>}

          {pullError && <p className="text-xs text-red-600 mt-2">{pullError}</p>}
          {autoNote && <div className="mt-2 p-2 rounded-md bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">{autoNote}</div>}

          {pricePrompt && (
            <div className="mt-2 p-2.5 rounded-md bg-amber-50 border border-amber-200">
              <p className="text-xs text-amber-900 mb-2">
                Comps moved {pricePrompt.pctDiff > 0 ? '+' : ''}{pricePrompt.pctDiff.toFixed(1)}% vs your price. Update to {money(Math.max(pricePrompt.newAvg, pricePrompt.floor))}?
                {pricePrompt.floor > pricePrompt.newAvg ? ' (held at your floor)' : ''}
              </p>
              <div className="flex gap-2">
                <button onClick={applyPricePrompt} className="h-7 px-3 rounded-md bg-stone-900 text-white text-xs font-medium">Update price</button>
                <button onClick={() => setPricePrompt(null)} className="h-7 px-3 rounded-md border border-stone-300 text-xs font-medium text-stone-600">Dismiss</button>
              </div>
            </div>
          )}

          {card.autoAdjustEnabled && (num(card.autoAdjustUpPercent) > 0 || num(card.autoAdjustDownPercent) > 0) && (
            <p className="text-[11px] text-stone-400 mt-2">
              Auto-adjust on: +{card.autoAdjustUpPercent || 0}% / -{card.autoAdjustDownPercent || 0}%{computeFloor(card) > 0 ? ` · floor ${money(computeFloor(card))}` : ''}
            </p>
          )}

          {card.compHistory && card.compHistory.length > 1 && (
            <button onClick={() => setShowGraph((v) => !v)} className="flex items-center gap-1 text-xs font-medium text-stone-600 mt-2">
              <TrendingUp size={12} /> {showGraph ? 'Hide trend' : 'Show trend'}
            </button>
          )}
          {showGraph && card.compHistory && card.compHistory.length > 1 && (
            <div className="mt-3 bg-stone-50 rounded-lg border border-stone-200 p-2" style={{ height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={card.compHistory.map((p) => ({ date: new Date(p.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), price: num(p.price) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} width={40} tickFormatter={(v) => `$${v}`} />
                  <Tooltip formatter={(v) => money(v)} />
                  <Line type="monotone" dataKey="price" stroke="#b45309" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 mb-2">
          <StatCard label="Purchase price" value={money(cost)} />
          <StatCard label={isPostSale(card.status) ? 'Sold price' : 'Est. current value'} value={money(value)} />
        </div>
        {isPostSale(card.status) ? (
          <StatCard label="Realized profit (after fees/shipping)" value={money(realizedProfit)} tone={realizedProfit >= 0 ? 'text-emerald-700' : 'text-red-600'} />
        ) : (
          <StatCard label="Unrealized profit" value={money(value - cost)} tone={value - cost >= 0 ? 'text-emerald-700' : 'text-red-600'} />
        )}

        <CollapsibleSection title="Card details" defaultOpen={true}>
          {(frontUrl || backUrl) && (
            <div className="flex gap-3 mb-4">
              {[frontUrl, backUrl].map((src, i) => src && (
                <img key={i} src={src} alt="" className="w-24 h-36 object-cover rounded-md border border-stone-200 bg-white" onError={(e) => { e.target.style.display = 'none'; }} />
              ))}
            </div>
          )}
          <h4 className="text-xs font-semibold text-stone-500 mb-1 mt-1">Identification</h4>
          <DetailRow label="Rarity" value={card.rarity} />
          <DetailRow label="Language" value={card.language} />
          <DetailRow label="Manufacturing info" value={card.manufacturingInfo} />
          <DetailRow label="SKU" value={card.sku} />
          <DetailRow label="Details" value={card.details} />

          <h4 className="text-xs font-semibold text-stone-500 mb-1 mt-4">Condition & grading</h4>
          <DetailRow label="Condition" value={card.condition} />
          <DetailRow label="Graded" value={card.graded ? 'Yes' : 'No'} />
          {card.graded && <>
            <DetailRow label="Grading company" value={card.gradingCompany} />
            <DetailRow label="Grade" value={card.grade} />
            <DetailRow label="Certification #" value={card.certNumber} />
          </>}

          <h4 className="text-xs font-semibold text-stone-500 mb-1 mt-4">Purchase</h4>
          <DetailRow label="Purchase date" value={card.purchaseDate} />
          <DetailRow label="Purchase location" value={card.purchaseLocation} />
          <DetailRow label="Storage location" value={card.storageLocation} />
        </CollapsibleSection>

        <CollapsibleSection title="Listing info" defaultOpen={!isPostSale(card.status)}>
          {!hasListingInfo ? (
            <div>
              <p className="text-sm text-stone-500 mb-3">No listing info yet. Generate it with AI, or write your own.</p>
              <div className="flex gap-2">
                <button onClick={handleGenerateListing} disabled={generating} className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-md bg-stone-900 text-white text-sm font-medium disabled:opacity-60">
                  <Sparkles size={14} /> {generating ? 'Writing...' : 'Auto-fill with AI'}
                </button>
                <button onClick={onEdit} className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-md border border-stone-300 bg-white text-sm font-medium text-stone-700">
                  <Pencil size={14} /> Enter manually
                </button>
              </div>
              {genError && <p className="text-xs text-red-600 mt-2">{genError}</p>}
            </div>
          ) : (
            <>
              <DetailRow label="Listing title" value={card.listingTitle} />
              <DetailRow label="Listing link" value={card.listingLink} />
              <DetailRow label="eBay item ID" value={card.ebayItemId} />
              <DetailRow label="eBay category ID" value={card.ebayCategoryId} />
              <DetailRow label="Posted date" value={card.postedDate} />
              <DetailRow label="Description" value={card.description} />
              <div className="flex gap-2 mt-3">
                <button onClick={handleGenerateListing} disabled={generating} className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-md border border-stone-300 bg-white text-sm font-medium text-stone-700 disabled:opacity-60">
                  <Sparkles size={14} /> {generating ? 'Writing...' : 'Regenerate'}
                </button>
                <button onClick={onEdit} className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-md border border-stone-300 bg-white text-sm font-medium text-stone-700">
                  <Pencil size={14} /> Edit
                </button>
              </div>
              <button onClick={handleCreateListing} className="w-full flex items-center justify-center gap-1.5 h-10 mt-2 rounded-md bg-stone-900 text-white text-sm font-medium">
                <ExternalLink size={14} /> {card.status === 'In inventory (ready to list)' ? 'Create eBay listing & mark as listed' : 'Create eBay listing'}
              </button>
              {genError && <p className="text-xs text-red-600 mt-2">{genError}</p>}
              {copied && <p className="text-xs text-emerald-700 mt-2">Title and description copied — paste them into eBay's listing form.</p>}
              <p className="text-[11px] text-stone-400 mt-2">This copies your listing text and opens eBay's sell page — full automatic posting needs the eBay API backend we talked about earlier.</p>
            </>
          )}
        </CollapsibleSection>

        <CollapsibleSection title="Shipping info" defaultOpen={['Sold - not shipped', 'Shipped'].includes(card.status)}>
          {isPreListing(card.status) || card.status === 'Listed' ? (
            <p className="text-sm text-stone-400">Shipping details become available once this card is marked sold.</p>
          ) : !hasShippingInfo ? (
            <div>
              <p className="text-sm text-stone-500 mb-3">No shipping info yet — add it before marking this shipped.</p>
              <button onClick={onEdit} className="w-full flex items-center justify-center gap-1.5 h-9 rounded-md bg-stone-900 text-white text-sm font-medium">
                <Pencil size={14} /> Add shipping info
              </button>
            </div>
          ) : (
            <>
              <DetailRow label="Buyer name" value={card.buyerName} />
              <DetailRow label="Buyer eBay username" value={card.buyerUsername} />
              <DetailRow label="Order number" value={card.orderNumber} />
              <DetailRow label="Delivery address" value={card.deliveryAddress} />
              <DetailRow label="Carrier" value={card.shippingCarrier} />
              <DetailRow label="Service" value={card.shippingService} />
              <DetailRow label="Drop-off date" value={card.dropOffDate} />
              <DetailRow label="Tracking number" value={card.trackingNumber} />
              <DetailRow label="Delivery status" value={card.deliveryStatus} />
              <DetailRow label="Est. delivery date" value={card.estDeliveryDate} />
              <DetailRow label="Delivered date" value={card.deliveredDate} />
              <div className="flex gap-2 mt-3">
                <button onClick={onEdit} className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-md border border-stone-300 bg-white text-sm font-medium text-stone-700">
                  <Pencil size={14} /> Edit
                </button>
              </div>
              {card.status === 'Sold - not shipped' && (
                <button onClick={onAdvance} className="w-full flex items-center justify-center gap-1.5 h-10 mt-2 rounded-md bg-stone-900 text-white text-sm font-medium">
                  Mark as shipped <ChevronRight size={14} />
                </button>
              )}
              {card.status === 'Shipped' && (
                <button onClick={onAdvance} className="w-full flex items-center justify-center gap-1.5 h-10 mt-2 rounded-md bg-stone-900 text-white text-sm font-medium">
                  Mark as delivered <ChevronRight size={14} />
                </button>
              )}
            </>
          )}
        </CollapsibleSection>

        <CollapsibleSection title="Sale & completion" defaultOpen={!isPreListing(card.status)}>
          {isPreListing(card.status) ? (
            <p className="text-sm text-stone-400">Sale details become available once this card is listed.</p>
          ) : card.status === 'Listed' ? (
            <div>
              <p className="text-sm text-stone-500 mb-3">Mark this card as sold once a buyer has purchased it.</p>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <Field label="Sold price"><input type="number" className={inputCls} value={soldPriceInput} onChange={(e) => setSoldPriceInput(e.target.value)} /></Field>
                <Field label="Sold date"><input type="date" className={inputCls} value={soldDateInput} onChange={(e) => setSoldDateInput(e.target.value)} /></Field>
              </div>
              <button onClick={handleMarkSold} className="w-full flex items-center justify-center gap-1.5 h-10 rounded-md bg-stone-900 text-white text-sm font-medium">
                Mark as sold <ChevronRight size={14} />
              </button>
            </div>
          ) : (
            <>
              <h4 className="text-xs font-semibold text-stone-500 mb-1">Sale outcome</h4>
              <DetailRow label="Sold price" value={money(card.soldPrice)} />
              <DetailRow label="Sold date" value={card.soldDate} />
              <DetailRow label="Shipping cost" value={card.shippingCost ? money(card.shippingCost) : ''} />
              <DetailRow label="Fees" value={card.fees ? money(card.fees) : ''} />
              {card.priceHistory && card.priceHistory.length > 0 && (
                <>
                  <h4 className="text-xs font-semibold text-stone-500 mb-1 mt-4">Price adjustment history</h4>
                  {card.priceHistory.slice().reverse().map((p, i) => <DetailRow key={i} label={p.date} value={money(p.price)} />)}
                </>
              )}
              {card.status === 'Delivered' && (
                <button onClick={onAdvance} className="w-full flex items-center justify-center gap-1.5 h-10 mt-3 rounded-md bg-stone-900 text-white text-sm font-medium">
                  Mark as complete <ChevronRight size={14} />
                </button>
              )}
            </>
          )}
        </CollapsibleSection>
      </div>
    </div>
  );
}

function EditForm({ card, isNew, initialPhotoFront, existingCards, onCancel, onSave }) {
  const [form, setForm] = useState({ ...emptyCard(), ...card });
  const [priceInput, setPriceInput] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState(null);

  const [photoFrontPreview, setPhotoFrontPreview] = useState(initialPhotoFront || null);
  const [photoFrontPending, setPhotoFrontPending] = useState(initialPhotoFront || null);
  const [removeFront, setRemoveFront] = useState(false);
  const [photoBackPreview, setPhotoBackPreview] = useState(null);
  const [photoBackPending, setPhotoBackPending] = useState(null);
  const [removeBack, setRemoveBack] = useState(false);

  useEffect(() => {
    let active = true;
    if (!initialPhotoFront && card.hasPhotoFront) {
      window.storage.get(`img:${card.id}:front`, false).then((r) => { if (active && r) setPhotoFrontPreview(r.value); }).catch(() => {});
    }
    if (card.hasPhotoBack) {
      window.storage.get(`img:${card.id}:back`, false).then((r) => { if (active && r) setPhotoBackPreview(r.value); }).catch(() => {});
    }
    return () => { active = false; };
  }, []);

  const set = (key) => (e) => {
    const val = e && e.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e;
    setForm((f) => ({ ...f, [key]: val }));
  };

  async function handleFrontFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const dataUrl = await fileToResizedDataUrl(file);
      setPhotoFrontPreview(dataUrl); setPhotoFrontPending(dataUrl); setRemoveFront(false);
    } catch (e2) { setErr('Could not read that image file.'); }
  }
  async function handleBackFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const dataUrl = await fileToResizedDataUrl(file);
      setPhotoBackPreview(dataUrl); setPhotoBackPending(dataUrl); setRemoveBack(false);
    } catch (e2) { setErr('Could not read that image file.'); }
  }
  function removeFrontPhoto() { setPhotoFrontPreview(null); setPhotoFrontPending(null); setRemoveFront(true); }
  function removeBackPhoto() { setPhotoBackPreview(null); setPhotoBackPending(null); setRemoveBack(true); }

  function addPricePoint() {
    if (!priceInput || isNaN(Number(priceInput))) { setErr('Enter a valid price first.'); return; }
    setErr('');
    const today = new Date().toISOString().slice(0, 10);
    setForm((f) => ({ ...f, buyItNowPrice: priceInput, priceHistory: [...(f.priceHistory || []), { date: today, price: priceInput }] }));
    setPriceInput('');
  }

  async function proceedSave() {
    setErr('');
    setSaving(true);
    const finalCard = { ...form };
    try {
      if (photoFrontPending) { await window.storage.set(`img:${form.id}:front`, photoFrontPending, false); finalCard.hasPhotoFront = true; }
      else if (removeFront) { try { await window.storage.delete(`img:${form.id}:front`, false); } catch (e) {} finalCard.hasPhotoFront = false; }
      if (photoBackPending) { await window.storage.set(`img:${form.id}:back`, photoBackPending, false); finalCard.hasPhotoBack = true; }
      else if (removeBack) { try { await window.storage.delete(`img:${form.id}:back`, false); } catch (e) {} finalCard.hasPhotoBack = false; }
    } catch (e) {
      setErr('Could not save the photo — the rest of the card was saved.');
    }
    setSaving(false);
    onSave(withAutoListingStatus(finalCard), isNew);
  }

  function handleSubmit() {
    if (!form.name.trim()) { setErr('Card name is required.'); return; }
    setErr('');
    if (isNew && existingCards) {
      const dup = findDuplicateCard(existingCards, form);
      if (dup) { setDuplicateWarning(dup); return; }
    }
    proceedSave();
  }

  return (
    <div className="min-h-screen bg-stone-50 font-sans overflow-x-hidden">
      <div className="max-w-2xl mx-auto px-4 pb-28">
        <header className="pt-6 pb-4 flex items-center justify-between sticky top-0 bg-stone-50 z-10">
          <button onClick={onCancel} className="flex items-center gap-1.5 text-sm text-stone-600"><ArrowLeft size={16} /> Cancel</button>
          <div className="text-center">
            <h1 className="text-sm font-semibold text-stone-900">{isNew ? 'Add item' : 'Edit card'}</h1>
            {!isNew && form.inventoryNumber && <p className="text-[11px] font-mono text-stone-400">{form.inventoryNumber}</p>}
          </div>
          <div className="w-14" />
        </header>

        {err && <div className="mb-4 px-3 py-2 rounded-md bg-red-50 text-red-700 text-xs border border-red-200">{err}</div>}

        <Section title="Photos">
          <div>
            <span className="block text-xs font-medium text-stone-500 mb-1">Front</span>
            {photoFrontPreview ? (
              <div className="relative w-full">
                <img src={photoFrontPreview} alt="" className="w-full h-36 object-cover rounded-md border border-stone-200" />
                <button type="button" onClick={removeFrontPhoto} className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-white/90 border border-stone-300 flex items-center justify-center"><X size={13} /></button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center gap-1 w-full h-36 rounded-md border border-dashed border-stone-300 bg-white cursor-pointer text-stone-400">
                <Camera size={18} /><span className="text-xs">Upload photo</span>
                <input type="file" accept="image/*" className="hidden" onChange={handleFrontFile} />
              </label>
            )}
          </div>
          <div>
            <span className="block text-xs font-medium text-stone-500 mb-1">Back</span>
            {photoBackPreview ? (
              <div className="relative w-full">
                <img src={photoBackPreview} alt="" className="w-full h-36 object-cover rounded-md border border-stone-200" />
                <button type="button" onClick={removeBackPhoto} className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-white/90 border border-stone-300 flex items-center justify-center"><X size={13} /></button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center gap-1 w-full h-36 rounded-md border border-dashed border-stone-300 bg-white cursor-pointer text-stone-400">
                <Camera size={18} /><span className="text-xs">Upload photo</span>
                <input type="file" accept="image/*" className="hidden" onChange={handleBackFile} />
              </label>
            )}
          </div>
        </Section>

        <Section title="Identification">
          <Field label="Card name *"><input className={inputCls} value={form.name} onChange={set('name')} placeholder="Charizard" /></Field>
          <Field label="Card type"><input className={inputCls} value={form.cardType} onChange={set('cardType')} placeholder="Pokemon" /></Field>
          <Field label="Set"><input className={inputCls} value={form.setName} onChange={set('setName')} placeholder="Base set" /></Field>
          <Field label="Card number"><input className={inputCls} value={form.cardNumber} onChange={set('cardNumber')} placeholder="4/102" /></Field>
          <Field label="Rarity"><input className={inputCls} value={form.rarity} onChange={set('rarity')} placeholder="Holo rare" /></Field>
          <Field label="Language"><input className={inputCls} value={form.language} onChange={set('language')} placeholder="English" /></Field>
          <Field label="Manufacturing info"><input className={inputCls} value={form.manufacturingInfo} onChange={set('manufacturingInfo')} placeholder="1st edition" /></Field>
          <Field label="SKU"><input className={inputCls} value={form.sku} onChange={set('sku')} placeholder="Internal ID" /></Field>
          <div className="col-span-2"><Field label="Additional details"><textarea className={textareaCls} rows={2} value={form.details} onChange={set('details')} /></Field></div>
        </Section>

        <Section title="Condition & grading">
          <Field label="Condition"><input className={inputCls} value={form.condition} onChange={set('condition')} placeholder="Near mint" /></Field>
          <Field label="Graded">
            <select className={selectCls} value={form.graded ? 'yes' : 'no'} onChange={(e) => set('graded')(e.target.value === 'yes')}>
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </Field>
          {form.graded && <>
            <Field label="Grading company"><input className={inputCls} value={form.gradingCompany} onChange={set('gradingCompany')} placeholder="PSA" /></Field>
            <Field label="Grade"><input className={inputCls} value={form.grade} onChange={set('grade')} placeholder="10" /></Field>
            <Field label="Certification #"><input className={inputCls} value={form.certNumber} onChange={set('certNumber')} /></Field>
          </>}
        </Section>

        <Section title="Purchase">
          <Field label="Purchase price"><input type="number" className={inputCls} value={form.purchasePrice} onChange={set('purchasePrice')} /></Field>
          <Field label="Purchase date"><input type="date" className={inputCls} value={form.purchaseDate} onChange={set('purchaseDate')} /></Field>
          <Field label="Purchase location"><input className={inputCls} value={form.purchaseLocation} onChange={set('purchaseLocation')} /></Field>
          <Field label="Storage location"><input className={inputCls} value={form.storageLocation} onChange={set('storageLocation')} placeholder="Bin 4" /></Field>
        </Section>

        <Section title="Status & listing">
          <Field label="Status">
            <select className={selectCls} value={form.status} onChange={set('status')}>
              {STATUS.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Comparable eBay avg"><input type="number" className={inputCls} value={form.comparablePrice} onChange={set('comparablePrice')} /></Field>
          <div className="col-span-2 text-xs text-stone-400 -mt-2">Use "Pull live price" from the card's detail view to fetch this automatically with a timestamp.</div>
          <div className="col-span-2"><Field label="Listing title"><input className={inputCls} value={form.listingTitle} onChange={set('listingTitle')} placeholder="Generated automatically, or write your own" /></Field></div>
          <div className="col-span-2"><Field label="Listing link"><input className={inputCls} value={form.listingLink} onChange={set('listingLink')} placeholder="https://ebay.com/itm/..." /></Field></div>
          <Field label="eBay item ID"><input className={inputCls} value={form.ebayItemId} onChange={set('ebayItemId')} /></Field>
          <Field label="eBay category ID"><input className={inputCls} value={form.ebayCategoryId} onChange={set('ebayCategoryId')} /></Field>
          <Field label="Date of original posting"><input type="date" className={inputCls} value={form.postedDate} onChange={set('postedDate')} /></Field>
          <div className="col-span-2"><Field label="eBay description"><textarea className={textareaCls} rows={3} value={form.description} onChange={set('description')} /></Field></div>
          <div className="col-span-2">
            <span className="block text-xs font-medium text-stone-500 mb-1">Buy-it-now price</span>
            <div className="flex gap-2">
              <input type="number" className={inputCls} value={priceInput || form.buyItNowPrice} onChange={(e) => setPriceInput(e.target.value)} placeholder="Update price" />
              <button type="button" onClick={addPricePoint} className="h-9 px-3 rounded-md bg-stone-900 text-white text-sm font-medium shrink-0">Update</button>
            </div>
            {form.priceHistory && form.priceHistory.length > 0 && <p className="text-xs text-stone-500 mt-1">{form.priceHistory.length} price change{form.priceHistory.length === 1 ? '' : 's'} logged</p>}
          </div>
        </Section>

        <Section title="Auto price adjustment">
          <div className="col-span-2 flex items-center justify-between bg-white rounded-md border border-stone-200 px-3 py-2">
            <span className="text-sm text-stone-700">Auto-adjust listing price</span>
            <button
              type="button"
              onClick={() => set('autoAdjustEnabled')(!form.autoAdjustEnabled)}
              className={`w-10 h-6 rounded-full relative transition ${form.autoAdjustEnabled ? 'bg-stone-900' : 'bg-stone-200'}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition ${form.autoAdjustEnabled ? 'left-4.5' : 'left-0.5'}`} style={{ left: form.autoAdjustEnabled ? '18px' : '2px' }} />
            </button>
          </div>
          <div className="col-span-2 text-xs text-stone-400 -mt-2">
            {form.autoAdjustEnabled ? 'Price updates automatically when comps cross these thresholds.' : "Off — you'll instead see a prompt to update the price manually."}
          </div>

          <Field label="Raise price if comps rise more than">
            <div className="flex items-center gap-1">
              <input type="number" className={inputCls} value={form.autoAdjustUpPercent} onChange={set('autoAdjustUpPercent')} placeholder="5" />
              <span className="text-sm text-stone-500 shrink-0">%</span>
            </div>
          </Field>
          <Field label="Lower price if comps fall more than">
            <div className="flex items-center gap-1">
              <input type="number" className={inputCls} value={form.autoAdjustDownPercent} onChange={set('autoAdjustDownPercent')} placeholder="3" />
              <span className="text-sm text-stone-500 shrink-0">%</span>
            </div>
          </Field>

          {(() => {
            const baseline = num(form.buyItNowPrice) || num(form.comparablePrice);
            if (!baseline) return <div className="col-span-2 text-xs text-stone-400">Set a buy-it-now price to preview what these thresholds would change it to.</div>;
            const up = num(form.autoAdjustUpPercent);
            const down = num(form.autoAdjustDownPercent);
            const floor = computeFloor(form);
            return (
              <div className="col-span-2 text-xs text-stone-500 space-y-0.5">
                {up > 0 && <p>If comps rise {up}%, price moves to <span className="font-medium text-stone-700">{money(baseline * (1 + up / 100))}</span></p>}
                {down > 0 && (() => {
                  const target = Math.max(baseline * (1 - down / 100), floor);
                  return <p>If comps fall {down}%, price moves to <span className="font-medium text-stone-700">{money(target)}</span>{target > baseline * (1 - down / 100) ? ' (held at floor)' : ''}</p>;
                })()}
              </div>
            );
          })()}

          <Field label="Price floor ($, optional)"><input type="number" className={inputCls} value={form.floorPrice} onChange={set('floorPrice')} placeholder="Never go below this" /></Field>
          <Field label="Price floor (% of cost, optional)">
            <div className="flex items-center gap-1">
              <input type="number" className={inputCls} value={form.floorPercentOfCost} onChange={set('floorPercentOfCost')} placeholder="110" />
              <span className="text-sm text-stone-500 shrink-0">%</span>
            </div>
          </Field>
          {form.floorPercentOfCost && form.purchasePrice && (
            <div className="col-span-2 text-xs text-stone-400 -mt-2">= {money(num(form.purchasePrice) * (num(form.floorPercentOfCost) / 100))} based on purchase price</div>
          )}
        </Section>

        {isPostSale(form.status) && (
          <>
            <Section title="Sale outcome">
              <Field label="Sold price"><input type="number" className={inputCls} value={form.soldPrice} onChange={set('soldPrice')} /></Field>
              <Field label="Sold date"><input type="date" className={inputCls} value={form.soldDate} onChange={set('soldDate')} /></Field>
              <Field label="Shipping cost"><input type="number" className={inputCls} value={form.shippingCost} onChange={set('shippingCost')} /></Field>
              <Field label="Estimated fees"><input type="number" className={inputCls} value={form.fees} onChange={set('fees')} /></Field>
            </Section>
            <Section title="Shipping & fulfillment">
              <Field label="Buyer name"><input className={inputCls} value={form.buyerName} onChange={set('buyerName')} /></Field>
              <Field label="Buyer eBay username"><input className={inputCls} value={form.buyerUsername} onChange={set('buyerUsername')} /></Field>
              <Field label="Order number"><input className={inputCls} value={form.orderNumber} onChange={set('orderNumber')} /></Field>
              <Field label="Tracking number"><input className={inputCls} value={form.trackingNumber} onChange={set('trackingNumber')} /></Field>
              <Field label="Carrier"><input className={inputCls} value={form.shippingCarrier} onChange={set('shippingCarrier')} placeholder="USPS" /></Field>
              <Field label="Service"><input className={inputCls} value={form.shippingService} onChange={set('shippingService')} placeholder="Ground Advantage" /></Field>
              <Field label="Drop-off date"><input type="date" className={inputCls} value={form.dropOffDate} onChange={set('dropOffDate')} /></Field>
              <Field label="Delivery status">
                <select className={selectCls} value={form.deliveryStatus} onChange={set('deliveryStatus')}>
                  <option value="">—</option>
                  {DELIVERY_STATUS.map((s) => <option key={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Est. delivery date"><input type="date" className={inputCls} value={form.estDeliveryDate} onChange={set('estDeliveryDate')} /></Field>
              <Field label="Delivered date"><input type="date" className={inputCls} value={form.deliveredDate} onChange={set('deliveredDate')} /></Field>
              <div className="col-span-2"><Field label="Delivery address"><textarea className={textareaCls} rows={2} value={form.deliveryAddress} onChange={set('deliveryAddress')} /></Field></div>
            </Section>
          </>
        )}

        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-stone-200 p-4">
          <div className="max-w-2xl mx-auto">
            {duplicateWarning && (
              <div className="mb-3 p-3 rounded-md bg-amber-50 border border-amber-200">
                <p className="text-xs text-amber-900 mb-2">
                  You already have <span className="font-medium">{duplicateWarning.name}</span> ({duplicateWarning.inventoryNumber}) in your {duplicateWarning.setName || 'inventory'}. Duplicate entry, or do you have two of this card?
                </p>
                <div className="flex gap-2">
                  <button onClick={() => { setDuplicateWarning(null); proceedSave(); }} className="flex-1 h-8 rounded-md bg-stone-900 text-white text-xs font-medium">Add anyway</button>
                  <button onClick={() => setDuplicateWarning(null)} className="flex-1 h-8 rounded-md border border-stone-300 bg-white text-xs font-medium text-stone-700">Don't add</button>
                </div>
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={onCancel} className="flex-1 h-11 rounded-md border border-stone-300 text-sm font-medium text-stone-700">Cancel</button>
              <button onClick={handleSubmit} disabled={saving} className="flex-1 h-11 rounded-md bg-stone-900 text-white text-sm font-medium disabled:opacity-60">
                {saving ? 'Saving...' : isNew ? 'Add to inventory' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const AGENT_TOOLS = [
  {
    name: 'search_cards',
    description: 'Search the inventory for cards matching a name, set, card number, inventory number, or status. Returns up to 15 matches with their id, name, set, status, and prices. Always use this first to find a card\'s id before calling any other tool.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Search text, e.g. a card name, set name, or status' } }, required: ['query'] },
  },
  {
    name: 'advance_status',
    description: 'Move a card forward one step in its lifecycle: In inventory -> Listed -> Sold - not shipped -> Shipped -> Delivered -> Complete. Use this for requests like "list my Charizard" or "mark the Blastoise as shipped".',
    input_schema: { type: 'object', properties: { card_id: { type: 'string' } }, required: ['card_id'] },
  },
  {
    name: 'set_status',
    description: 'Set a card status directly to any value, including "Cancelled / Delisted". Use this only when advance_status would not reach the target status directly (e.g. delisting, or moving backward).',
    input_schema: { type: 'object', properties: { card_id: { type: 'string' }, status: { type: 'string', enum: STATUS } }, required: ['card_id', 'status'] },
  },
  {
    name: 'set_price',
    description: "Update a card's buy-it-now price.",
    input_schema: { type: 'object', properties: { card_id: { type: 'string' }, price: { type: 'number' } }, required: ['card_id', 'price'] },
  },
  {
    name: 'generate_listing',
    description: "Write an eBay listing title and description for a card and save it to that card. Use this when asked to draft, write, or generate listing copy.",
    input_schema: { type: 'object', properties: { card_id: { type: 'string' } }, required: ['card_id'] },
  },
];

function ChatPanel({ cards, stats, sets, onCardsChange }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  function buildContext(cardList) {
    const compact = cardList.map((c) => ({
      id: c.id, inventoryNumber: c.inventoryNumber, name: c.name, set: c.setName, type: c.cardType, status: c.status,
      cost: num(c.purchasePrice),
      buyItNowPrice: c.buyItNowPrice ? num(c.buyItNowPrice) : null,
      comparablePrice: c.comparablePrice ? num(c.comparablePrice) : null,
      value: isPostSale(c.status) ? num(c.soldPrice) : (num(c.comparablePrice) || num(c.buyItNowPrice) || num(c.purchasePrice)),
      purchaseDate: c.purchaseDate, soldDate: c.soldDate, condition: c.condition,
      graded: c.graded ? `${c.gradingCompany || ''} ${c.grade || ''}`.trim() : null,
    }));
    return {
      summary: {
        totalCards: stats.count, totalCostBasis: stats.totalCost, totalEstValue: stats.totalValue,
        unrealizedProfit: stats.profit, distinctSets: sets.length,
        statusBreakdown: STATUS.reduce((a, s) => ({ ...a, [s]: cardList.filter((c) => c.status === s).length }), {}),
      },
      cards: compact,
    };
  }

  async function executeTool(name, input, working) {
    if (name === 'search_cards') {
      const q = String(input.query || '').toLowerCase();
      const matches = working.filter((c) => [c.name, c.setName, c.status, c.inventoryNumber, c.cardType].join(' ').toLowerCase().includes(q));
      if (matches.length === 0) return { result: 'No cards found matching that search.', working };
      return {
        result: JSON.stringify(matches.slice(0, 15).map((c) => ({ id: c.id, name: c.name, set: c.setName, status: c.status, inventoryNumber: c.inventoryNumber, buyItNowPrice: c.buyItNowPrice, comparablePrice: c.comparablePrice }))),
        working,
      };
    }
    const idx = working.findIndex((c) => c.id === input.card_id);
    if (idx === -1) return { result: `No card found with id "${input.card_id}". Use search_cards first to get the correct id.`, working };
    const c = working[idx];

    if (name === 'advance_status') {
      const action = NEXT_ACTION[c.status];
      if (!action) return { result: `${c.name} is already at "${c.status}" and has no further automatic stage.`, working };
      const next = working.slice();
      next[idx] = applyAdvance(c);
      return { result: `Moved ${c.name} (${c.inventoryNumber}) from ${c.status} to ${action.next}.`, working: next };
    }
    if (name === 'set_status') {
      if (!STATUS.includes(input.status)) return { result: `"${input.status}" is not a valid status.`, working };
      const next = working.slice();
      next[idx] = { ...c, status: input.status };
      return { result: `Set ${c.name}'s status to ${input.status}.`, working: next };
    }
    if (name === 'set_price') {
      const today = new Date().toISOString().slice(0, 10);
      const next = working.slice();
      next[idx] = { ...c, buyItNowPrice: String(input.price), priceHistory: [...(c.priceHistory || []), { date: today, price: String(input.price) }] };
      return { result: `Updated ${c.name}'s buy-it-now price to ${money(input.price)}.`, working: next };
    }
    if (name === 'generate_listing') {
      try {
        const listing = await generateListingCopy(c);
        const next = working.slice();
        next[idx] = withAutoListingStatus({ ...c, listingTitle: listing.title, description: listing.description });
        return { result: `Generated listing copy for ${c.name}. Title: "${listing.title}"`, working: next };
      } catch (e) {
        return { result: `Could not generate listing copy for ${c.name} right now.`, working };
      }
    }
    return { result: `Unknown tool "${name}".`, working };
  }

  async function send() {
    const question = input.trim();
    if (!question) return;
    setInput('');
    setErr('');
    const nextMessages = [...messages, { role: 'user', content: question }];
    setMessages(nextMessages);
    setLoading(true);

    let working = cards.map((c) => ({ ...c }));
    let convo = nextMessages.map((m) => ({ role: m.role, content: m.content }));

    try {
      for (let step = 0; step < 6; step++) {
        const response = await fetch(ANTHROPIC_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 1200,
            system: `You are an operations agent for a collectibles resale business (Pokemon cards, comics, toys) that sells on eBay. You can both answer questions and take actions using the tools provided — moving cards through their lifecycle, updating prices, and generating listing copy. Always search_cards first to find the correct card id before acting on it, and if a search returns multiple plausible matches, ask the person which one they mean rather than guessing. Confirm what you did in plain language at the end. Be concise. Format currency clearly.\n\nInventory summary (JSON):\n${JSON.stringify(buildContext(working))}`,
            tools: AGENT_TOOLS,
            messages: convo,
          }),
        });
        const data = await response.json();
        const content = data.content || [];
        const toolUses = content.filter((b) => b.type === 'tool_use');
        const textBlocks = content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

        if (toolUses.length === 0) {
          setMessages((prev) => [...prev, { role: 'assistant', content: textBlocks || "I couldn't find an answer to that." }]);
          break;
        }

        convo.push({ role: 'assistant', content });
        const toolResults = [];
        for (const tu of toolUses) {
          const outcome = await executeTool(tu.name, tu.input, working);
          working = outcome.working;
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: outcome.result });
        }
        convo.push({ role: 'user', content: toolResults });

        if (step === 5) {
          setMessages((prev) => [...prev, { role: 'assistant', content: "I made some updates but stopped after a few steps — let me know if you'd like me to keep going." }]);
        }
      }
      onCardsChange(working);
    } catch (e) {
      setErr('Something went wrong reaching the assistant. Try again.');
      setMessages((prev) => prev.slice(0, -1));
      setInput(question);
    }
    setLoading(false);
  }

  return (
    <div>
      <div className="space-y-3 mb-4">
        {messages.length === 0 && (
          <div className="text-center py-10 px-4 bg-white rounded-lg border border-dashed border-stone-300">
            <p className="text-sm font-medium text-stone-700 mb-1">Ask, or ask it to act</p>
            <p className="text-sm text-stone-500">Try "list my Charizard" or "mark the Blastoise as shipped" or "what's my most profitable set?"</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${m.role === 'user' ? 'bg-stone-900 text-white' : 'bg-white border border-stone-200 text-stone-900'}`}>{m.content}</div>
          </div>
        ))}
        {loading && <div className="flex justify-start"><div className="bg-white border border-stone-200 rounded-lg px-3 py-2 text-sm text-stone-400">Working…</div></div>}
      </div>
      {err && <div className="mb-3 px-3 py-2 rounded-md bg-red-50 text-red-700 text-xs border border-red-200">{err}</div>}
      <div className="flex gap-2 sticky bottom-4">
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !loading) send(); }} placeholder="Ask a question, or ask it to do something..." className="flex-1 h-10 px-3 rounded-md border border-stone-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
        <button onClick={send} disabled={loading} className="h-10 w-10 shrink-0 rounded-md bg-stone-900 text-white flex items-center justify-center disabled:opacity-50"><Send size={16} /></button>
      </div>
    </div>
  );
}
