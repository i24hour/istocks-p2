# GitHub Actions Azure Deployment Setup

This guide will help you set up automated deployment to Azure using GitHub Actions.

## 📋 Prerequisites

- GitHub repository: `i24hour/istocks-p`
- Azure Web App: `istocks-app` (already created ✅)
- Azure publish profile (already downloaded ✅)

## 🔐 Step 1: Add GitHub Secrets

You need to add 3 secrets to your GitHub repository:

### 1. Go to GitHub Repository Settings

- Navigate to: https://github.com/i24hour/istocks-p/settings/secrets/actions
- Click **"New repository secret"**

### 2. Add AZURE_WEBAPP_PUBLISH_PROFILE

**Name:** `AZURE_WEBAPP_PUBLISH_PROFILE`

**Value:** Copy the entire contents of `azure-publish-profile.xml` file (in your project root)

```bash
# To view the publish profile:
cat azure-publish-profile.xml
```

Copy everything including `<publishData>` tags and paste into GitHub secret.

### 3. Add DATABASE_URL

**Name:** `DATABASE_URL`

**Value:**

```
postgresql://istocks:<YOUR_PASSWORD>@istocks.postgres.database.azure.com:5432/stock_analysis?sslmode=require
```

Replace `<YOUR_PASSWORD>` with your actual Azure PostgreSQL password.

### 4. Add GEMINI_API_KEY

**Name:** `GEMINI_API_KEY`

**Value:**

```
AIzaSyAu59eg_Nha_JZPrPfnSyoXTwanOtnIP-0
```

---

## 🚀 Step 2: Push to GitHub

Once secrets are added, push your code:

```bash
git add .
git commit -m "Add GitHub Actions deployment workflow"
git push origin main
```

The GitHub Action will automatically:

1. ✅ Install dependencies
2. ✅ Generate Prisma client
3. ✅ Build Next.js app
4. ✅ Deploy to Azure App Service
5. ✅ Configure environment variables

---

## 📊 Step 3: Monitor Deployment

1. Go to: https://github.com/i24hour/istocks-p/actions
2. Watch the deployment progress
3. Once complete, your app will be live at: **https://istocks-app.azurewebsites.net**

---

## 🔧 Configure Azure Database Firewall

After deployment, allow Azure services to access your database:

```bash
az postgres flexible-server firewall-rule create \
  --resource-group istocks \
  --name istocks \
  --rule-name AllowAzureServices \
  --start-ip-address 0.0.0.0 \
  --end-ip-address 0.0.0.0
```

---

## 🎯 Quick Commands

### View Publish Profile

```bash
cat azure-publish-profile.xml
```

### Check App Status

```bash
az webapp show --name istocks-app --resource-group istocks --query state -o tsv
```

### View App Logs

```bash
az webapp log tail --name istocks-app --resource-group istocks
```

### Restart App

```bash
az webapp restart --name istocks-app --resource-group istocks
```

---

## 🔄 Future Deployments

Every time you push to the `main` branch, GitHub Actions will automatically:

- Build your app
- Deploy to Azure
- Update environment variables

You can also manually trigger deployment from GitHub Actions tab!

---

## ⚠️ Security Note

**IMPORTANT:** Delete `azure-publish-profile.xml` after copying it to GitHub secrets!

```bash
rm azure-publish-profile.xml
```

Add it to `.gitignore` to prevent accidental commits:

```bash
echo "azure-publish-profile.xml" >> .gitignore
```

---

## 🎉 That's It!

Your continuous deployment pipeline is ready! 🚀
