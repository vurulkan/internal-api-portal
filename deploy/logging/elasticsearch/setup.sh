#!/bin/sh
# Installs the internal-api-portal log templates into Elasticsearch (8.13 or newer).
# Idempotent: re-running updates everything in place.
#
#   ES_URL=https://es.example:9200 ES_AUTH=elastic:changeme ./setup.sh
#   ES_URL=https://es.example:9200 ES_API_KEY=<base64 id:key> ./setup.sh
#
# The account needs the manage_ilm, manage_index_templates and manage_pipeline
# cluster privileges. Extra curl options (e.g. --cacert ca.crt) go in CURL_OPTS.
set -eu
cd "$(dirname "$0")"
: "${ES_URL:=http://localhost:9200}"

put() {
  set -- "$1" "$2" -fsS -X PUT -H 'Content-Type: application/json'
  if [ -n "${ES_API_KEY:-}" ]; then
    set -- "$@" -H "Authorization: ApiKey ${ES_API_KEY}"
  elif [ -n "${ES_AUTH:-}" ]; then
    set -- "$@" -u "${ES_AUTH}"
  fi
  path=$1 file=$2
  shift 2
  printf '%-40s ' "$path"
  # shellcheck disable=SC2086
  curl "$@" ${CURL_OPTS:-} --data-binary "@$file" "${ES_URL}/${path}"
  echo
}

for dataset in audit http app; do
  put "_ilm/policy/portal-${dataset}" "ilm-portal-${dataset}.json"
done
put "_component_template/portal@mappings" component-template-portal-mappings.json
put "_ingest/pipeline/portal-route" ingest-pipeline-portal-route.json
for dataset in audit http app; do
  put "_index_template/logs-portal.${dataset}" "index-template-portal-${dataset}.json"
done
put "_index_template/logs-portal" index-template-portal.json
