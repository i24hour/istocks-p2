#!/bin/bash

# Azure deployment script for iStocks
# Make sure you have Azure CLI installed and logged in

set -e

echo "🚀 Starting Azure Container Apps deployment..."

# Variables
RESOURCE_GROUP="istocks"
LOCATION="centralindia"
CONTAINER_APP_NAME="istocks-app"
CONTAINER_APP_ENV="istocks-env"
ACR_NAME="istocksacr"
IMAGE_NAME="istocks"
IMAGE_TAG="latest"

# Database connection string
DB_HOST="istocks.postgres.database.azure.com"
DB_USER="istocks"
DB_NAME="stock_analysis"
DB_PORT="5432"

echo "📋 Configuration:"
echo "  Resource Group: $RESOURCE_GROUP"
echo "  Location: $LOCATION"
echo "  Container App: $CONTAINER_APP_NAME"
echo ""

# Check if logged in to Azure
echo "🔐 Checking Azure CLI login..."
az account show > /dev/null 2>&1 || {
    echo "❌ Not logged in to Azure. Please run: az login"
    exit 1
}

echo "✅ Azure CLI logged in"

# Create Container Registry if it doesn't exist
echo "📦 Creating Azure Container Registry..."
az acr create \
  --resource-group $RESOURCE_GROUP \
  --name $ACR_NAME \
  --sku Basic \
  --location $LOCATION \
  --admin-enabled true \
  || echo "ACR already exists"

# Get ACR credentials
echo "🔑 Getting ACR credentials..."
ACR_USERNAME=$(az acr credential show --name $ACR_NAME --query username -o tsv)
ACR_PASSWORD=$(az acr credential show --name $ACR_NAME --query passwords[0].value -o tsv)
ACR_LOGIN_SERVER=$(az acr show --name $ACR_NAME --query loginServer -o tsv)

echo "✅ ACR: $ACR_LOGIN_SERVER"

# Build Docker image in Azure (no local Docker needed)
echo "🏗️  Building Docker image in Azure..."
az acr build \
  --registry $ACR_NAME \
  --image $IMAGE_NAME:$IMAGE_TAG \
  --file Dockerfile \
  .

echo "✅ Image built and pushed successfully"

# Create Container Apps Environment if it doesn't exist
echo "🌍 Creating Container Apps Environment..."
az containerapp env create \
  --name $CONTAINER_APP_ENV \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  || echo "Environment already exists"

# Prompt for database password
echo ""
echo "🔐 Database Configuration:"
read -sp "Enter Azure PostgreSQL password for user 'istocks': " DB_PASSWORD
echo ""

# Prompt for Gemini API key
read -p "Enter your Gemini API Key: " GEMINI_API_KEY
echo ""

# Create/Update Container App
echo "🚀 Deploying Container App..."
az containerapp create \
  --name $CONTAINER_APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --environment $CONTAINER_APP_ENV \
  --image $ACR_LOGIN_SERVER/$IMAGE_NAME:$IMAGE_TAG \
  --registry-server $ACR_LOGIN_SERVER \
  --registry-username $ACR_USERNAME \
  --registry-password $ACR_PASSWORD \
  --target-port 8080 \
  --ingress external \
  --min-replicas 1 \
  --max-replicas 3 \
  --cpu 1.0 \
  --memory 2Gi \
  --env-vars \
    "DATABASE_URL=postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME?sslmode=require" \
    "GEMINI_API_KEY=$GEMINI_API_KEY" \
    "NODE_ENV=production" \
    "TZ=Asia/Kolkata" \
  || {
    echo "⚠️  Container app exists, updating..."
    az containerapp update \
      --name $CONTAINER_APP_NAME \
      --resource-group $RESOURCE_GROUP \
      --image $ACR_LOGIN_SERVER/$IMAGE_NAME:$IMAGE_TAG \
      --set-env-vars \
        "DATABASE_URL=postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME?sslmode=require" \
        "GEMINI_API_KEY=$GEMINI_API_KEY" \
        "NODE_ENV=production" \
        "TZ=Asia/Kolkata"
  }

# Get the app URL
echo ""
echo "🎉 Deployment complete!"
echo ""
APP_URL=$(az containerapp show \
  --name $CONTAINER_APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --query properties.configuration.ingress.fqdn -o tsv)

echo "✅ Your app is live at: https://$APP_URL"
echo ""
echo "📊 Next steps:"
echo "  1. Test your app at the URL above"
echo "  2. Configure your database firewall to allow Azure services"
echo "  3. Monitor logs: az containerapp logs show -n $CONTAINER_APP_NAME -g $RESOURCE_GROUP"
echo ""
