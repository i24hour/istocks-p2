# 🔧 Vercel Deployment Troubleshooting Guide

## Error: "I apologize, but I encountered an error while analyzing the data"

This error occurs when the AI chatbot fails to process your query. Follow these steps to diagnose and fix:

---

## 🔍 **Step 1: Check Vercel Logs (MOST IMPORTANT)**

### How to Access Logs:
1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project: `istocks-p`
3. Click on **"Logs"** tab
4. Look for entries with ❌ emoji or error messages
5. Search for your query time (around 02:16 AM in your case)

### What to Look For:
- `❌ Error analyzing stock:` - Main error location
- `❌ Gemini API error:` - AI service failure
- `❌ Error executing generated code:` - Database query failure
- `GEMINI_API_KEY is not configured` - Missing environment variable
- `timeout` - Request took too long
- `P2002` or `P****` - Database errors

---

## 🔐 **Step 2: Verify Environment Variables**

### Check in Vercel Dashboard:
1. Go to your project → **Settings** → **Environment Variables**
2. Verify these are set:

```
✅ DATABASE_URL          (PostgreSQL connection string from Azure)
✅ GEMINI_API_KEY        (Your Gemini API key)
✅ TZ                    (Should be: Asia/Kolkata)
✅ NODE_ENV              (Should be: production)
```

### Common Issues:
- **DATABASE_URL format**: Should be `postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require`
- **GEMINI_API_KEY**: Must start with `AIza...` (get from Google AI Studio)
- **Missing variables**: Add them and **redeploy**

### How to Add/Fix:
1. Click **"Add New"** for missing variables
2. **Save**
3. Go to **Deployments** tab → Click **"Redeploy"** on latest deployment

---

## 🗄️ **Step 3: Test Database Connection**

### Check Azure Database:
1. Go to [Azure Portal](https://portal.azure.com)
2. Find your PostgreSQL database
3. Check **"Connection security"**:
   - ✅ Allow Azure services: **ON**
   - ✅ Add Vercel IPs (if using static IPs)
4. Check **"Networking"**:
   - Ensure firewall allows connections from `0.0.0.0/0` (public) OR add Vercel's IP ranges

### Test Connection String:
```bash
# Run locally to test
npx prisma db pull --preview-feature
```

If this fails, your `DATABASE_URL` is incorrect.

---

## ⏱️ **Step 4: Check Vercel Function Timeouts**

### Free Tier Limits:
- **10 seconds** max execution time
- Your query "last 40 days how many times stock reach 240" requires:
  - Gemini API call: ~2-5 seconds
  - Database query: ~3-10 seconds
  - **Total: 5-15 seconds** ⚠️

### Solution:
**Upgrade to Vercel Pro** ($20/month):
- 60 second timeout
- Better performance
- More concurrent executions

OR

**Optimize Database**:
- Add indexes (already done in your schema)
- Use Azure Premium tier for faster queries

---

## 🔧 **Step 5: Check Prisma Connection Pooling**

### Update `prisma/schema.prisma`:
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

### Update `DATABASE_URL` to include connection pooling:
```
postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require&connection_limit=5&pool_timeout=10
```

Add these parameters:
- `connection_limit=5` - Limit concurrent connections
- `pool_timeout=10` - Timeout after 10 seconds

---

## 🧪 **Step 6: Test Query Locally**

### Run the Same Query Locally:
```bash
# 1. Set environment variables
export DATABASE_URL="your_azure_connection_string"
export GEMINI_API_KEY="your_gemini_key"

# 2. Start dev server
npm run dev

# 3. Open browser to http://localhost:3002
# 4. Ask the same question
```

### Expected Behavior:
- If works locally but NOT on Vercel → Environment variable issue
- If fails both places → Database or Gemini API issue
- If times out locally → Query too complex, need optimization

---

## 🚨 **Common Issues & Solutions**

### Issue 1: "GEMINI_API_KEY is not configured"
**Fix**: Add `GEMINI_API_KEY` to Vercel environment variables

### Issue 2: "Database query timeout after 20 seconds"
**Fix**: 
- Upgrade Vercel plan (60s timeout)
- Optimize query (reduce date range)
- Check Azure database tier (Basic tier is slow)

### Issue 3: "Gemini API timeout after 25 seconds"
**Fix**:
- Check Gemini API quota: [Google AI Studio](https://makersuite.google.com/app/apikey)
- Verify API key is valid
- Check if API is rate limited

### Issue 4: "Cannot connect to database"
**Fix**:
- Check Azure firewall settings
- Verify `DATABASE_URL` format
- Test connection with `psql` or database client

### Issue 5: Random timeouts
**Fix**:
- Azure Basic tier → Upgrade to General Purpose
- Add connection pooling parameters
- Check Azure database metrics for high CPU/memory

---

## 📊 **Step 7: Monitor Performance**

### Check Azure Metrics:
1. Go to Azure Portal → Your Database
2. Check **"Monitoring"** → **"Metrics"**:
   - CPU usage (should be < 80%)
   - Memory usage (should be < 80%)
   - Active connections (should be < limit)
   - Query duration (should be < 5 seconds)

### High CPU/Memory?
- Upgrade database tier
- Add indexes (already done)
- Optimize queries

---

## ✅ **Quick Fix Checklist**

Run through this checklist:

- [ ] Check Vercel logs for actual error
- [ ] Verify all environment variables are set
- [ ] Test DATABASE_URL with `npx prisma db pull`
- [ ] Verify Gemini API key at [Google AI Studio](https://makersuite.google.com/app/apikey)
- [ ] Check Azure firewall allows connections
- [ ] Redeploy after fixing environment variables
- [ ] Test same query locally
- [ ] Check Vercel function timeout (10s free, 60s pro)
- [ ] Monitor Azure database performance

---

## 📞 **Still Not Working?**

### Collect This Information:
1. **Vercel Log Screenshot** (from Logs tab)
2. **Environment Variables** (names only, not values!)
3. **Azure Database Tier** (Basic/General Purpose/Business Critical)
4. **Vercel Plan** (Free/Pro)
5. **Error timestamp** (from when error occurred)

### Next Steps:
1. **Check Vercel Logs First** - This will tell you exactly what's wrong
2. Share the error log here (remove sensitive info)
3. I can provide specific fix based on actual error

---

## 🔄 **After Making Changes**

1. Save all changes
2. **Git commit and push**:
   ```bash
   git add .
   git commit -m "Fix: Add better error handling and timeouts"
   git push
   ```
3. Vercel will auto-deploy
4. Wait 1-2 minutes for deployment
5. Test again

---

## 📈 **Expected Behavior After Fix**

When working correctly, you should see:
- ✅ Query responds in 5-15 seconds
- ✅ Shows generated code in debug section
- ✅ Returns accurate data with dates and values
- ✅ No error messages

If still getting errors, check Vercel logs and share the specific error message!
