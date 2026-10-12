package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"api-portal/backend/internal/models"
)

type searchBody struct {
	APIs       []models.APISummary `json:"apis"`
	Operations []searchResult      `json:"operations"`
}

func (e *testEnv) search(token, q string) searchBody {
	e.t.Helper()
	var out searchBody
	if err := json.Unmarshal([]byte(e.expect(http.MethodGet, "/api/search?q="+url.QueryEscape(q), token, nil, http.StatusOK)), &out); err != nil {
		e.t.Fatal(err)
	}
	return out
}

func (e *testEnv) catalog(token string) map[int]models.APISummary {
	e.t.Helper()
	var list []models.APISummary
	if err := json.Unmarshal([]byte(e.expect(http.MethodGet, "/api/catalog", token, nil, http.StatusOK)), &list); err != nil {
		e.t.Fatal(err)
	}
	out := map[int]models.APISummary{}
	for _, item := range list {
		out[item.ID] = item
	}
	return out
}

func (e *testEnv) api(name string) int {
	e.t.Helper()
	id, err := e.store.CreateAPIDefinition(context.Background(), models.APIDefinition{Name: name, Slug: strings.ToLower(strings.ReplaceAll(name, " ", "-")), InternalOpenAPIURL: "http://127.0.0.1:1/spec", InternalBaseURL: "http://127.0.0.1:1", IsActive: true, TryItEnabled: true})
	if err != nil {
		e.t.Fatal(err)
	}
	return id
}

const paymentsSpec = `{"openapi":"3.0.0","info":{"title":"Payments","version":"2.3.1"},"paths":{
 "/v1/charges":{"post":{"operationId":"createCharge","summary":"Create a charge","tags":["charges"]},"get":{"operationId":"listCharges","summary":"List charges","tags":["charges"]}},
 "/v1/charges/{id}":{"get":{"operationId":"getCharge","description":"Fetch one charge.\nMore text.","tags":["charges"]},"delete":{"operationId":"cancelCharge","deprecated":true}},
 "/v1/refunds":{"post":{"operationId":"createRefund","summary":"Refund a charge"}}}}`

// The spec is fetched on refresh and its operations become searchable; deleting
// the API removes them from the index.
func TestOperationIndexFollowsTheSpec(t *testing.T) {
	spec := paymentsSpec
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(spec))
	}))
	defer upstream.Close()
	e := newEnv(t)
	ctx := context.Background()
	e.user("root", true)
	root := e.login("root")
	id, _ := e.store.CreateAPIDefinition(ctx, models.APIDefinition{Name: "Payments", Slug: "payments", InternalOpenAPIURL: upstream.URL + "/spec", InternalBaseURL: upstream.URL, IsActive: true})
	e.expect(http.MethodPost, fmt.Sprintf("/api/admin/apis/%d/refresh", id), root, nil, http.StatusOK)

	item := e.catalog(root)[id]
	if item.SpecVersion != "2.3.1" || item.OperationCount == nil || *item.OperationCount != 5 || item.SpecState != "ok" {
		t.Fatalf("catalog entry: %+v", item)
	}
	got := e.search(root, "charg")
	if len(got.Operations) < 4 || got.Operations[0].APIName != "Payments" {
		t.Fatalf("search charg: %+v", got.Operations)
	}
	// Words match as prefixes, in any column; the description is the fallback summary.
	if ops := e.search(root, "v1 refunds").Operations; len(ops) != 1 || ops[0].OperationID != "createRefund" {
		t.Fatalf("path words: %+v", ops)
	}
	if ops := e.search(root, "getCharge").Operations; len(ops) != 1 || ops[0].Summary != "Fetch one charge." {
		t.Fatalf("operationId: %+v", ops)
	}
	if ops := e.search(root, "cancelCharge").Operations; len(ops) != 1 || !ops[0].Deprecated || ops[0].Method != "DELETE" {
		t.Fatalf("deprecated: %+v", ops)
	}
	// FTS syntax in the input is matched literally, never an error.
	for _, q := range []string{`"`, `charge AND`, `* OR x`, `col:value`, `NEAR(a b)`, `'; DROP TABLE x`} {
		e.search(root, q)
	}

	// A new spec replaces the old operations.
	spec = `{"openapi":"3.0.0","info":{"version":2},"paths":{"/v2/payouts":{"get":{"summary":"List payouts"}}}}`
	e.expect(http.MethodPost, fmt.Sprintf("/api/admin/apis/%d/refresh", id), root, nil, http.StatusOK)
	if ops := e.search(root, "charges").Operations; len(ops) != 0 {
		t.Fatalf("old operations still indexed: %+v", ops)
	}
	if item := e.catalog(root)[id]; item.SpecVersion != "2" || *item.OperationCount != 1 {
		t.Fatalf("after refresh: %+v", item)
	}

	e.expect(http.MethodDelete, fmt.Sprintf("/api/admin/apis/%d", id), root, nil, http.StatusOK)
	if ops := e.search(root, "payouts").Operations; len(ops) != 0 {
		t.Fatalf("deleted API still indexed: %+v", ops)
	}
	var left int
	_ = e.dbConn.QueryRow(`SELECT count(*) FROM api_operations_fts`).Scan(&left)
	if left != 0 {
		t.Fatalf("%d FTS rows left after delete", left)
	}
}

// Search returns only what the user may see, and stays fast on a large catalog.
func TestSearchIsFilteredByPermissionAndFast(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	var ids []int
	for i := 0; i < 100; i++ {
		id := e.api(fmt.Sprintf("Service %03d", i))
		ops := make([]models.APIOperation, 30)
		for j := range ops {
			ops[j] = models.APIOperation{Method: "GET", Path: fmt.Sprintf("/v1/service%03d/resource%02d/{id}", i, j), OperationID: fmt.Sprintf("getResource%02d", j), Summary: fmt.Sprintf("Read resource %d of service %d", j, i), Tags: []string{"resources"}}
		}
		if err := e.store.ReplaceAPIOperations(ctx, id, "1.0", ops); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	plain := e.user("plain", false)
	e.grant(plain.ID, fmt.Sprintf("api:%d:view", ids[7]))
	user := e.login("plain")
	e.user("root", true)
	root := e.login("root")

	got := e.search(user, "resource")
	if len(got.Operations) == 0 {
		t.Fatal("no results for the visible API")
	}
	for _, op := range got.Operations {
		if op.APIID != ids[7] {
			t.Fatalf("operation of API %d (not visible) in results", op.APIID)
		}
	}
	if apis := e.search(user, "Service").APIs; len(apis) != 1 || apis[0].ID != ids[7] {
		t.Fatalf("API results: %+v", apis)
	}
	// 3000 operations: each query under 100 ms (the handler, end to end; CI runs this
	// without -race too, see ci.yml).
	for _, q := range []string{"resource", "service042", "getResource17", "read resource service", "v1 res"} {
		start := time.Now()
		res := e.search(root, q)
		took := time.Since(start)
		t.Logf("search %q: %s, %d operations", q, took, len(res.Operations))
		if took > 100*time.Millisecond && !raceEnabled {
			t.Errorf("search %q took %s", q, took)
		}
		if len(res.Operations) == 0 {
			t.Errorf("search %q: no results", q)
		}
	}
	if len(e.search(root, "x").Operations) != 0 {
		t.Error("one-character queries should return nothing")
	}
}

func TestFavoritesAndRecentlyViewed(t *testing.T) {
	e := newEnv(t)
	a := e.api("Alpha")
	b := e.api("Beta")
	hidden := e.api("Hidden")
	plain := e.user("plain", false)
	e.grant(plain.ID, fmt.Sprintf("api:%d:view", a), fmt.Sprintf("api:%d:view", b))
	token := e.login("plain")

	e.expect(http.MethodPut, fmt.Sprintf("/api/me/favorites/%d", b), token, nil, http.StatusOK)
	e.expect(http.MethodPut, fmt.Sprintf("/api/me/favorites/%d", hidden), token, nil, http.StatusForbidden)
	if c := e.catalog(token); !c[b].Favorite || c[a].Favorite {
		t.Fatalf("favorites: %+v", c)
	}
	e.expect(http.MethodDelete, fmt.Sprintf("/api/me/favorites/%d", b), token, nil, http.StatusOK)
	if e.catalog(token)[b].Favorite {
		t.Fatal("favorite not removed")
	}
	actions := strings.Join(e.auditActions(), " ")
	if !strings.Contains(actions, "api.favorite_add.success") || !strings.Contains(actions, "api.favorite_remove.success") || !strings.Contains(actions, "api.favorite_add.denied") {
		t.Fatalf("audit: %s", actions)
	}

	e.expect(http.MethodGet, fmt.Sprintf("/api/apis/%d", a), token, nil, http.StatusOK)
	if c := e.catalog(token); c[a].LastViewedAt == nil || c[b].LastViewedAt != nil {
		t.Fatalf("recent: %+v", c)
	}
	// Only the last 10 views are kept.
	ctx := context.Background()
	for i := 0; i < 15; i++ {
		id := e.api(fmt.Sprintf("Extra %d", i))
		if err := e.store.RecordAPIView(ctx, plain.ID, id); err != nil {
			t.Fatal(err)
		}
	}
	recent, _ := e.store.RecentAPIViews(ctx, plain.ID)
	if len(recent) != 10 {
		t.Fatalf("%d recent views kept, want 10", len(recent))
	}
}

// The spec error text can name internal hosts: only the API's managers get it.
func TestSpecErrorDetailOnlyForManagers(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	id := e.api("Ledger")
	if err := e.store.MarkSpecRefreshFailure(ctx, id, `Get "http://10.20.30.40:8080/openapi.json": dial tcp 10.20.30.40:8080: connect: connection refused`); err != nil {
		t.Fatal(err)
	}
	viewer := e.user("viewer", false)
	e.grant(viewer.ID, fmt.Sprintf("api:%d:view", id))
	manager := e.user("manager", false)
	e.grant(manager.ID, fmt.Sprintf("api:%d:manage", id))
	viewerToken, managerToken := e.login("viewer"), e.login("manager")

	for _, path := range []string{"/api/catalog", fmt.Sprintf("/api/apis/%d", id)} {
		body := e.expect(http.MethodGet, path, viewerToken, nil, http.StatusOK)
		if strings.Contains(body, "10.20.30.40") || !strings.Contains(body, `"specState":"error"`) {
			t.Errorf("viewer %s: %s", path, body)
		}
		if body := e.expect(http.MethodGet, path, managerToken, nil, http.StatusOK); !strings.Contains(body, "10.20.30.40") {
			t.Errorf("manager %s lacks the detail: %s", path, body)
		}
	}
}

// Specs cached by 1.6.0 (no operation index yet) are indexed at startup.
func TestIndexMissingSpecsBackfills(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	id := e.api("Payments")
	if err := e.store.SaveSpecCache(ctx, id, models.APISpecCache{APIID: id, SpecJSON: json.RawMessage(paymentsSpec), FetchedAt: time.Now()}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.dbConn.Exec(`UPDATE api_definitions SET operation_count = NULL`); err != nil {
		t.Fatal(err)
	}
	e.srv.IndexMissingSpecs(ctx)
	e.user("root", true)
	if item := e.catalog(e.login("root"))[id]; item.OperationCount == nil || *item.OperationCount != 5 || item.SpecVersion != "2.3.1" {
		t.Fatalf("after backfill: %+v", item)
	}
	if ids, _ := e.store.APIsMissingOperationIndex(ctx); len(ids) != 0 {
		t.Fatalf("still missing: %v", ids)
	}
}

// A saved API's spec is fetched right away (no one has to open it first), and the
// scheduled refresh covers every active API.
func TestSpecsAreFetchedWithoutAnyoneOpeningThem(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(paymentsSpec))
	}))
	defer upstream.Close()
	e := newEnv(t)
	e.srv.config.SpecRefreshInterval = time.Hour
	e.user("root", true)
	root := e.login("root")
	body := map[string]any{"name": "Payments", "slug": "payments", "internalOpenapiUrl": upstream.URL + "/spec", "internalBaseUrl": upstream.URL, "isActive": true}
	var created struct{ ID int }
	_ = json.Unmarshal([]byte(e.expect(http.MethodPost, "/api/admin/apis", root, body, http.StatusCreated)), &created)
	e.srv.background.Wait()
	if item := e.catalog(root)[created.ID]; item.OperationCount == nil || *item.OperationCount != 5 {
		t.Fatalf("not fetched after create: %+v", item)
	}

	ctx := context.Background()
	inactive, _ := e.store.CreateAPIDefinition(ctx, models.APIDefinition{Name: "Old", Slug: "old", InternalOpenAPIURL: upstream.URL + "/spec", InternalBaseURL: upstream.URL, IsActive: false})
	active, _ := e.store.CreateAPIDefinition(ctx, models.APIDefinition{Name: "New", Slug: "new", InternalOpenAPIURL: upstream.URL + "/spec", InternalBaseURL: upstream.URL, IsActive: true})
	e.srv.refreshAllSpecs(ctx)
	c := e.catalog(root)
	if c[active].OperationCount == nil || c[inactive].OperationCount != nil {
		t.Fatalf("scheduled refresh: active %+v, inactive %+v", c[active], c[inactive])
	}
}
