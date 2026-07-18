#!/bin/sh
cd /home/zrid/meetvap/server
npm ci
npm run prisma:generate
npm run prisma:deploy
npm run build
pm2 restart messenger-server

