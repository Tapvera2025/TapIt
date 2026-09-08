-- Local/runtime bootstrap: 0001 intentionally creates the app role without
-- login. Give it a password so the containerized API can use its least-
-- privilege role; production deployments should inject this from a secret.
ALTER ROLE tapcrm_app LOGIN PASSWORD 'app_dev_password';
