# 🚀 Deployment Checklist - Vercel + Azure

## 📝 Pre-Deployment Steps

### 1. Run Local Tests
```bash
# Test your configuration locally first
npx ts-node test-deployment.ts
```

All tests should pass ✅ before deploying.

---

## 🔐 Vercel Environment Variables

Go to Vercel Dashboard → Your Project → Settings → Environment Variables

### Required Variables:

| Variable | Value | Where to Get It |
|----------|-------|-----------------|
| `DATABASE_URL` | `postgresql://USER:PASSWORD@HOST.postgres.database.azure.com:5432/DATABASE?sslmode=require` | Azure Portal → PostgreSQL → Connection strings |
| `GEMINI_API_KEY` | `AIzaSyC...` | [Google AI Studio](https://makersuite.google.com/app/apikey) |
| `TZ` | `Asia/Kolkata` | Timezone for India |
| `NODE_ENV` | `production` | Production environment |

### How to Set:
1. Click **"Add New"**
2. Enter **Name** and **Value**
3. Select **"Production"** environment
4. Click **"Save"**
5. **Redeploy** after adding all variables

---

## 🗄️ Azure Database Configuration

### 1. Firewall Settings
**Azure Portal → PostgreSQL → Networking → Firewall Rules**

Add this rule:
- **Name**: `AllowVercel`
- **Start IP**: `0.0.0.0`
- **End IP**: `0.0.0.0` (this allows all IPs)

⚠️ **Security Note**: For production, restrict to [Vercel's IP ranges](https://vercel.com/docs/concepts/deployments/ip-addresses)

### 2. SSL Enforcement
**Azure Portal → PostgreSQL → Connection Security**
- ✅ **Enforce SSL**: ON

### 3. Database Tier (Important!)
**Basic Tier**: Slow, may cause timeouts
- ⚠️ 5-10 second queries
- ❌ Not recommended for production

**General Purpose**: Faster
- ✅ 1-3 second queries
- ✅ Recommended

**Business Critical**: Fastest
- ✅ < 1 second queries
- 💰 Expensive

### 4. Connection Pooling
Add to your `DATABASE_URL`:
```
?sslmode=require&connection_limit=5&pool_timeout=10
```

Full example:
```
postgresql://user:password@host.postgres.database.azure.com:5432/db?sslmode=require&connection_limit=5&pool_timeout=10
```

---

## ⚙️ Vercel Configuration

### 1. Function Timeout
**Free Plan**: 10 seconds ⚠️
- May timeout for complex queries
- Not suitable for "last 40 days" type queries

**Pro Plan**: 60 seconds ✅
- Recommended for production
- $20/month

### 2. Build Settings
Ensure these are set in Vercel:

- **Framework Preset**: Next.js
- **Build Command**: `npm run build`
- **Output Directory**: `.next`
- **Install Command**: `npm install`

### 3. Environment
All environment variables must be set for **Production** environment.

---

## 🔍 Testing After Deployment

### 1. Check Build Logs
Vercel Dashboard → Deployments → Click latest → **"Building"** tab

Look for:
- ✅ `Prisma generate` completed
- ✅ `Build succeeded`
- ❌ Any errors?

### 2. Check Runtime Logs
Vercel Dashboard → **Logs** tab

Filter by:
- **Time**: Your query time
- **Status**: 500 errors
- **Search**: Your error message

### 3. Test the App
Visit your deployed URL and:
1. Go to `/stock/WIPRO`
2. Ask: "What's the current price?"
3. Should respond in < 5 seconds
4. If error, check logs immediately

---

## 🐛 Common Deployment Errors

### Error 1: "Environment variable not configured"
**Fix**: Add missing env var in Vercel → Settings → Environment Variables → Redeploy

### Error 2: "Database connection failed"
**Fix**: Check Azure firewall, verify DATABASE_URL format

### Error 3: "Function timeout"
**Fix**: Upgrade to Vercel Pro OR optimize queries OR upgrade Azure database tier

### Error 4: "Gemini API error"
**Fix**: Verify API key at [Google AI Studio](https://makersuite.google.com/app/apikey), check quota

### Error 5: Build fails with Prisma error
**Fix**: Ensure `prisma generate` runs in build command:
```json
"scripts": {
  "build": "prisma generate && next build"
}
```

---

## 📊 Monitoring After Deployment

### Check These Metrics:

#### Vercel Dashboard:
- **Analytics**: Response times (should be < 10s)
- **Logs**: Any 500 errors?
- **Bandwidth**: Usage patterns

#### Azure Portal:
- **CPU**: Should be < 80%
- **Memory**: Should be < 80%
- **Connections**: Should be < 100
- **Query Duration**: Should be < 5 seconds

---

## ✅ Deployment Success Criteria

Your deployment is successful when:

- [x] All environment variables set in Vercel
- [x] Azure firewall allows connections
- [x] Build succeeds without errors
- [x] App loads at deployed URL
- [x] Can navigate to `/stock/WIPRO`
- [x] AI chatbot responds to queries
- [x] Queries complete in < 10 seconds (Free) or < 60 seconds (Pro)
- [x] No errors in Vercel logs
- [x] Azure database CPU < 80%

---

## 🔄 Updating Deployment

When you fix issues:

```bash
# 1. Make your changes
# 2. Test locally
npm run dev

# 3. Commit and push
git add .
git commit -m "Fix: [describe your fix]"
git push

# 4. Vercel auto-deploys (wait 1-2 minutes)
# 5. Check Vercel logs for any errors
# 6. Test on deployed URL
```

---

## 🆘 Need Help?

If deployment still fails:

1. **Run test script**:
   ```bash
   npx ts-node test-deployment.ts
   ```

2. **Check Vercel logs** (most important!)

3. **Collect this info**:
   - Screenshot of Vercel logs error
   - Your Vercel plan (Free/Pro)
   - Your Azure database tier
   - Environment variable names (not values!)

4. **Share the specific error message**

See **VERCEL_TROUBLESHOOTING.md** for detailed debugging steps.

---

## 📚 Useful Links

- [Vercel Dashboard](https://vercel.com/dashboard)
- [Azure Portal](https://portal.azure.com)
- [Google AI Studio](https://makersuite.google.com/app/apikey)
- [Vercel Docs](https://vercel.com/docs)
- [Next.js Deployment](https://nextjs.org/docs/deployment)
