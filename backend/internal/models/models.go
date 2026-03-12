package models

import (
	"encoding/json"
	"time"
)

type User struct {
	ID                 int       `json:"id"`
	Username           string    `json:"username"`
	DisplayName        string    `json:"displayName"`
	Email              string    `json:"email"`
	PasswordHash       string    `json:"-"`
	AuthSource         string    `json:"authSource"`
	MustChangePassword bool      `json:"mustChangePassword"`
	IsActive           bool      `json:"isActive"`
	IsAdmin            bool      `json:"isAdmin"`
	CreatedAt          time.Time `json:"createdAt"`
	UpdatedAt          time.Time `json:"updatedAt"`
}

type Group struct {
	ID          int       `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"createdAt"`
}

type Role struct {
	ID          int       `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"createdAt"`
}

type Permission struct {
	ID          int       `json:"id"`
	RoleID      int       `json:"roleId"`
	Scope       string    `json:"scope"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"createdAt"`
}

type LDAPConfig struct {
	Enabled            bool     `json:"enabled"`
	URL                string   `json:"url"`
	Host               string   `json:"host"`
	Port               int      `json:"port"`
	UseSSL             bool     `json:"useSsl"`
	StartTLS           bool     `json:"startTls"`
	SkipVerify         bool     `json:"sslSkipVerify"`
	TimeoutSeconds     int      `json:"timeoutSeconds"`
	BindDN             string   `json:"bindDn"`
	BindPassword       string   `json:"bindPassword,omitempty"`
	UserBaseDN         string   `json:"userBaseDn"`
	UserBaseDNs        []string `json:"userBaseDns"`
	UserFilter         string   `json:"userFilter"`
	UsernameAttribute  string   `json:"usernameAttribute"`
	DisplayNameAttr    string   `json:"displayNameAttribute"`
	EmailAttr          string   `json:"emailAttribute"`
	PasswordConfigured bool     `json:"passwordConfigured"`
}

type SessionSettings struct {
	SessionMinutes int `json:"sessionMinutes"`
}

type SystemSettings struct {
	BrandTitle string `json:"brandTitle"`
	LogoDataURL string `json:"logoDataUrl"`
}

type APIDefinition struct {
	ID                 int       `json:"id"`
	Name               string    `json:"name"`
	Slug               string    `json:"slug"`
	Description        string    `json:"description"`
	InternalOpenAPIURL string    `json:"internalOpenapiUrl,omitempty"`
	InternalBaseURL    string    `json:"internalBaseUrl,omitempty"`
	IsActive           bool      `json:"isActive"`
	TryItEnabled       bool      `json:"tryItEnabled"`
	AllowedMethods     []string  `json:"allowedMethods"`
	AllowedPathPrefixes []string `json:"allowedPathPrefixes"`
	OwnerTeam          string    `json:"ownerTeam"`
	Tags               []string  `json:"tags"`
	CreatedAt          time.Time `json:"createdAt"`
	UpdatedAt          time.Time `json:"updatedAt"`
	LastSpecRefreshAt  *time.Time `json:"lastSpecRefreshAt,omitempty"`
	LastSpecStatus     string    `json:"lastSpecStatus,omitempty"`
}

type APISummary struct {
	ID                int       `json:"id"`
	Name              string    `json:"name"`
	Slug              string    `json:"slug"`
	Description       string    `json:"description"`
	IsActive          bool      `json:"isActive"`
	TryItEnabled      bool      `json:"tryItEnabled"`
	OwnerTeam         string    `json:"ownerTeam"`
	Tags              []string  `json:"tags"`
	LastSpecRefreshAt *time.Time `json:"lastSpecRefreshAt,omitempty"`
	LastSpecStatus    string    `json:"lastSpecStatus,omitempty"`
	CanView           bool      `json:"canView"`
	CanInvoke         bool      `json:"canInvoke"`
	CanManage         bool      `json:"canManage"`
}

type APISpecCache struct {
	APIID          int             `json:"apiId"`
	SpecJSON       json.RawMessage `json:"specJson"`
	ETag           string          `json:"etag"`
	FetchedAt      time.Time       `json:"fetchedAt"`
	LastError      string          `json:"lastError"`
	SourceFormat   string          `json:"sourceFormat"`
}

type AuditLog struct {
	ID              int       `json:"id"`
	Timestamp       time.Time `json:"timestamp"`
	User            string    `json:"user"`
	Action          string    `json:"action"`
	ResourceType    string    `json:"resourceType"`
	ResourceID      string    `json:"resourceId"`
	ResourceName    string    `json:"resourceName"`
	SourceIP        string    `json:"sourceIp"`
	StatusCode      int       `json:"statusCode"`
	DurationMs      int64     `json:"durationMs"`
	RequestBytes    int64     `json:"requestBytes"`
	ResponseBytes   int64     `json:"responseBytes"`
	Blocked         bool      `json:"blocked"`
	ErrorMessage    string    `json:"errorMessage"`
	SanitizedHeader string    `json:"sanitizedHeaders"`
	DetailsJSON     string    `json:"detailsJson"`
}

type LDAPUser struct {
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Email       string `json:"email"`
	DN          string `json:"dn"`
}

type Identity struct {
	User        User     `json:"user"`
	Permissions []string `json:"permissions"`
	GroupIDs    []int    `json:"groupIds"`
}
