# cc-playground — a tiny nginx image that introspects its own confidential
# context. Built on nginx-unprivileged (non-root, listens on 8080) so it runs
# unmodified under OpenShift's restricted SCC, and it's small (~20 MB) so it
# fits comfortably inside a confidential micro-VM guest.
FROM nginxinc/nginx-unprivileged:1.27-alpine

# Static frontend.
COPY html/ /usr/share/nginx/html/

# Server config: serve the frontend, expose /info.json, reverse-proxy /cdh/.
COPY nginx/default.conf /etc/nginx/conf.d/default.conf

# Startup hook that detects the TEE and emits /tmp/cc-info.json before nginx
# starts. The base image's entrypoint runs every executable in this directory.
COPY docker-entrypoint.d/40-cc-info.sh /docker-entrypoint.d/40-cc-info.sh

USER root
RUN chmod +x /docker-entrypoint.d/40-cc-info.sh
USER 101

EXPOSE 8080
