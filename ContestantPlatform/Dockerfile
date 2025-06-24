# Sử dụng Node.js để build ứng dụng
FROM node:18 AS builder
WORKDIR /app

# Copy file cấu hình trước để cache tốt hơn
COPY package.json ./

# Cài đặt dependencies với xử lý xung đột
RUN npm install --legacy-peer-deps

# Copy toàn bộ mã nguồn còn lại
COPY . .

# Build frontend
RUN npm run build
