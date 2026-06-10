# Azure Deployment Guide for iStocks

## Prerequisites

1. ✅ Azure CLI installed (`az --version` to check)
2. ✅ Docker installed and running
3. ✅ Azure database password ready
4. ✅ Gemini API key ready

## Quick Deploy (Automated)

```bash
# Make script executable
chmod +x deploy-azure.sh

# Run deployment
./deploy-azure.sh
```

The script will:

- Create Azure Container Registry
- Build and push Docker image
- Deploy to Azure Container Apps
- Configure all environment variables

## Manual Deployment Steps

### Step 1: Login to Azure

```bash
az login
az account set --subscription "ae7ed4aa-e56d-4f03-a993-3862666c22a0"
```

### Step 2: Create Container Registry

```bash
az acr create \
  --resource-group istocks \
  --name istocksacr \
  --sku Basic \
  --location centralindia \
  --admin-enabled true
```

### Step 3: Build and Push Image

```bash
# Login to ACR
az acr login --name istocksacr

# Build image
docker build -t istocks:latest .

# Tag image
docker tag istocks:latest istocksacr.azurecr.io/istocks:latest

# Push to ACR
docker push istocksacr.azurecr.io/istocks:latest
```

### Step 4: Create Container Apps Environment

```bash
az containerapp env create \
  --name istocks-env \
  --resource-group istocks \
  --location centralindia
```

### Step 5: Deploy Container App

```bash
# Get ACR credentials
ACR_USERNAME=$(az acr credential show --name istocksacr --query username -o tsv)
ACR_PASSWORD=$(az acr credential show --name istocksacr --query passwords[0].value -o tsv)

# Deploy app
az containerapp create \
  --name istocks-app \
  --resource-group istocks \
  --environment istocks-env \
  --image istocksacr.azurecr.io/istocks:latest \
  --registry-server istocksacr.azurecr.io \
  --registry-username $ACR_USERNAME \
  --registry-password $ACR_PASSWORD \
  --target-port 8080 \
  --ingress external \
  --min-replicas 1 \
  --max-replicas 3 \
  --cpu 1.0 \
  --memory 2Gi \
  --env-vars \
    "DATABASE_URL=postgresql://istocks:YOUR_PASSWORD@istocks.postgres.database.azure.com:5432/stock_analysis?sslmode=require" \
    "GEMINI_API_KEY=AIzaSyAcowHj8agBQCVgMAB-VjQ5570rHdukcwE" \
    "NODE_ENV=production" \
    "TZ=Asia/Kolkata"
```

**Replace:**

- `YOUR_PASSWORD` with your Azure PostgreSQL password

### Step 6: Get App URL

```bash
az containerapp show \
  --name istocks-app \
  --resource-group istocks \
  --query properties.configuration.ingress.fqdn -o tsv
```

## Database Configuration

### Allow Azure Services

1. Go to Azure Portal → PostgreSQL server → Networking
2. Enable "Allow public access from any Azure service"
3. Add your IP address if testing locally

### Create Database (if needed)

```bash
# Connect to your Azure database
psql "host=istocks.postgres.database.azure.com port=5432 dbname=postgres user=istocks sslmode=require"

# Create database
CREATE DATABASE stock_analysis;

# Run migrations
npx prisma db push
```

## Monitoring & Logs

### View Logs

```bash
az containerapp logs show \
  --name istocks-app \
  --resource-group istocks \
  --follow
```

### Check App Status

```bash
az containerapp show \
  --name istocks-app \
  --resource-group istocks
```

### Update App (after code changes)

```bash
# Rebuild and push
docker build -t istocks:latest .
docker tag istocks:latest istocksacr.azurecr.io/istocks:latest
docker push istocksacr.azurecr.io/istocks:latest

# Update container app
az containerapp update \
  --name istocks-app \
  --resource-group istocks \
  --image istocksacr.azurecr.io/istocks:latest
```

## Troubleshooting

### Check Container App Health

```bash
az containerapp revision list \
  --name istocks-app \
  --resource-group istocks \
  -o table
```

### Database Connection Issues

1. Check firewall rules in Azure Portal
2. Verify connection string format
3. Ensure SSL mode is enabled

### App Not Starting

```bash
# View detailed logs
az containerapp logs show \
  --name istocks-app \
  --resource-group istocks \
  --tail 100
```

## Cost Optimization

- **Free Tier**: First 180K vCPU-seconds free/month
- **Auto-scaling**: Scales to 0 when not in use
- **Pricing**: ~$0.000012/vCPU-second after free tier

## Next Steps

1. ✅ Deploy the app
2. ✅ Test the URL
3. ✅ Import your data to Azure database
4. ✅ Set up custom domain (optional)
5. ✅ Configure monitoring alerts
