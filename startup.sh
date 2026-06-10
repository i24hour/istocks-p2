#!/bin/bash
cd /home/site/wwwroot
npm install
npx prisma generate
npm run build
npm run start
