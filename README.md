# Ecom Analyzer

E-ticaret sitelerinde conversion kaybına neden olan hataları otomatik tespit eden B2B SaaS platform.

## Proje Yapısı

```
ecom-analyzer/
├── apps/
│   ├── backend/          → Node.js/Express → Railway
│   └── frontend/         → Next.js App Router → Vercel (sonraki adım)
├── packages/
│   └── shared/           → Ortak TypeScript tipleri
├── railway.toml          → Railway deploy config
└── package.json          → Monorepo workspace config
```

## MVP Özellikleri

- [x] Crawler (axios + cheerio, BFS, depth-limited)
- [x] Kırık link tespiti (404 / 500)
- [ ] Filtre tutarlılığı testi
- [ ] Arama kalitesi testi
- [ ] Listeleme problemi tespiti
- [ ] Frontend UI

## Railway Kurulumu

1. Railway'de yeni proje oluştur
2. GitHub repo'yu bağla
3. **Root Directory**: `/` (monorepo root)
4. **Environment Variables** ekle:
   ```
   DATABASE_URL=postgresql://...
   NODE_ENV=production
   PORT=3001
   ```
5. Railway otomatik olarak `railway.toml`'u kullanır

## Railway PostgreSQL

1. Railway dashboard → "New Service" → "Database" → "PostgreSQL"
2. Oluşturulan `DATABASE_URL`'yi backend servisinin env variable'ına ekle
3. Migration çalıştır: Railway'de "Deploy Logs"dan kontrol et

## API Endpoint'leri

### Yeni Scan Başlat
```
POST /api/scans
Content-Type: application/json

{ "url": "https://example.com" }
```

### Scan Sonuçlarını Getir
```
GET /api/scans/:id
```

### Tüm Scan'leri Listele
```
GET /api/scans
```

### Health Check
```
GET /health
```

## Issue Formatı

```json
{
  "id": "uuid",
  "type": "broken_link | filter_inconsistency | search_quality | listing_problem",
  "severity": "low | medium | high",
  "description": "İnsan okunabilir açıklama",
  "repro_steps": ["Adım 1", "Adım 2", "Adım 3"],
  "metadata": {}
}
```
