# Deployment Guide - Jump Rope Counter

This application is a **Static Web Application**. This means it doesn't require a backend server (like Node.js, Python, or PHP) to run. It only needs a web server to serve the HTML, CSS, and JavaScript files.

## 1. Build the Project

You have already successfully built the project. The production-ready files are located in the `dist` folder:

```
/Users/zhaozh/.gemini/antigravity/scratch/jump-rope-counter/dist
```

## 2. Deployment Options

### Option A: Static Hosting (Recommended)
The easiest way to deploy is using a specialized static hosting provider.

#### Vercel / Netlify
1.  Create an account on [Vercel](https://vercel.com) or [Netlify](https://netlify.com).
2.  Install their CLI tool or connect your GitHub repository.
3.  **Settings**:
    - **Build Command**: `npm run build`
    - **Output Directory**: `dist`

#### GitHub Pages
1.  Push your code to a GitHub repository.
2.  Go to Settings > Pages.
3.  Select your branch and folder (usually requires a specific workflow for Vite apps, or use the `gh-pages` package).

### Option B: Traditional Web Server (Nginx/Apache)
If you have your own Linux server (e.g., Ubuntu, CentOS), you can use Nginx.

1.  **Upload Files**: Copy the contents of the `dist` folder to your server (e.g., `/var/www/jump-rope`).
2.  **Configure Nginx**:
    ```nginx
    server {
        listen 80;
        server_name your-domain.com;

        root /var/www/jump-rope;
        index index.html;

        location / {
            try_files $uri $uri/ /index.html;
        }
    }
    ```
3.  **Restart Nginx**: `sudo systemctl restart nginx`

### Option C: Docker
You can containerize the app using Nginx to serve the static files.

1.  Create a `Dockerfile` in the project root:
    ```dockerfile
    # Build Stage
    FROM node:18-alpine as build
    WORKDIR /app
    COPY package*.json ./
    RUN npm install
    COPY . .
    RUN npm run build

    # Production Stage
    FROM nginx:alpine
    COPY --from=build /app/dist /usr/share/nginx/html
    EXPOSE 80
    CMD ["nginx", "-g", "daemon off;"]
    ```
2.  Build and Run:
    ```bash
    docker build -t jump-rope-app .
    docker run -p 8080:80 jump-rope-app
    ```
    Access at `http://localhost:8080`.

## Important Notes
- **HTTPS**: Since this app uses the **Camera**, it **MUST be served over HTTPS** (secure connection) when deployed to a remote server. Browsers block camera access on insecure HTTP sites (except for localhost).
- **MediaPipe**: The app loads AI models from a CDN (`cdn.jsdelivr.net`). Ensure your server has internet access or the client's browser can reach this domain.
