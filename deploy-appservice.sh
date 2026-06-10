#!/bin/bash

# Azure App Service deployment script for iStocks
# Deploys directly from source code - no Docker needed!

set -e

echo "🚀 Starting Azure App Service deployment..."

# Variables
RESOURCE_GROUP="istocks"
LOCATION="centralindia"
APP_SERVICE_PLAN="istocks-plan"
APP_NAME="istocks-app"

# Database connection string
DB_HOST="istocks.postgres.database.azure.com"
DB_USER="istocks"
DB_NAME="stock_analysis"
DB_PORT="5432"

echo "📋 Configuration:"
echo "  Resource Group: $RESOURCE_GROUP"
echo "  Location: $LOCATION"
echo "  App Service: $APP_NAME"
echo ""

# Check if logged in to Azure
echo "🔐 Checking Azure CLI login..."
az account show > /dev/null 2>&1 || {
    echo "❌ Not logged in to Azure. Please run: az login"
    exit 1
}

echo "✅ Azure CLI logged in"

# Create App Service Plan if it doesn't exist
echo "📦 Creating App Service Plan..."
az appservice plan create \
  --name $APP_SERVICE_PLAN \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --sku B1 \
  --is-linux \
  || echo "App Service Plan already exists"

# Create Web App if it doesn't exist
echo "🌐 Creating Web App..."
az webapp create \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --plan $APP_SERVICE_PLAN \
  --runtime "NODE:20-lts" \
  || echo "Web App already exists"

# Prompt for database password
echo ""
echo "🔐 Database Configuration:"
read -sp "Enter Azure PostgreSQL password for user 'istocks': " DB_PASSWORD
echo ""

# Prompt for Gemini API key
read -p "Enter your Gemini API Key: " GEMINI_API_KEY
echo ""

# Configure app settings (environment variables)
echo "⚙️  Configuring environment variables..."
az webapp config appsettings set \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --settings \
    DATABASE_URL="postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME?sslmode=require" \
    GEMINI_API_KEY="$GEMINI_API_KEY" \
    NODE_ENV="production" \
    TZ="Asia/Kolkata" \
    SCM_DO_BUILD_DURING_DEPLOYMENT="true" \
    WEBSITE_NODE_DEFAULT_VERSION="20-lts"

# Deploy from local git
echo "📤 Deploying application..."
az webapp up \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --plan $APP_SERVICE_PLAN \
  --runtime "NODE:20-lts" \
  --location $LOCATION

# Get the app URL
echo ""
echo "🎉 Deployment complete!"
echo ""
APP_URL=$(az webapp show \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --query defaultHostName -o tsv)

echo "✅ Your app is live at: https://$APP_URL"
echo ""
echo "📊 Next steps:"
echo "  1. Test your app at the URL above"
echo "  2. Configure your database firewall to allow Azure services"
echo "  3. Monitor logs: az webapp log tail -n $APP_NAME -g $RESOURCE_GROUP"
echo ""
