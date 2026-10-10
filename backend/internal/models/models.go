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
	ExternalID         string    `json:"-"`
	CreatedAt          time.Time `json:"createdAt"`
	UpdatedAt          time.Time `json:"updatedAt"`
}

type Group struct {
	ID          int       `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"createdAt"`
	// Directory groups mirrored into this group at sign-in (empty: not mapped).
	AzureGroupID string `json:"azureGroupId"`
	LDAPGroupDN  string `json:"ldapGroupDn"`
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

type AzureADConfig struct {
	Enabled            bool   `json:"enabled"`
	TenantID           string `json:"tenantId"`
	ClientID           string `json:"clientId"`
	ClientSecret       string `json:"clientSecret,omitempty"`
	RedirectURL        string `json:"redirectUrl"`
	PasswordConfigured bool   `json:"passwordConfigured"`
	// AllowedGroups, when set, limits sign-in to members of these Azure AD group
	// object ids (needs the "groups" claim in the app registration).
	AllowedGroups []string `json:"allowedGroups"`
}

// SessionSettings: a session ends after SessionMinutes without activity (idle
// timeout) or MaxHours after sign-in, whichever comes first.
type SessionSettings struct {
	SessionMinutes int `json:"sessionMinutes"`
	MaxHours       int `json:"maxHours"`
}

// Session is a signed-in browser. The token itself is never stored, only its hash.
type Session struct {
	ID         int        `json:"id"`
	UserID     int        `json:"userId"`
	Username   string     `json:"username,omitempty"`
	AuthSource string     `json:"authSource"`
	CreatedAt  time.Time  `json:"createdAt"`
	LastUsedAt time.Time  `json:"lastUsedAt"`
	ExpiresAt  time.Time  `json:"expiresAt"`
	RevokedAt  *time.Time `json:"revokedAt,omitempty"`
	IP         string     `json:"ip"`
	UserAgent  string     `json:"userAgent"`
	Current    bool       `json:"current,omitempty"`
}

type SystemSettings struct {
	BrandTitle  string `json:"brandTitle"`
	LogoDataURL string `json:"logoDataUrl"`
}

type APIDefinition struct {
	ID                  int        `json:"id"`
	Name                string     `json:"name"`
	Slug                string     `json:"slug"`
	Description         string     `json:"description"`
	InternalOpenAPIURL  string     `json:"internalOpenapiUrl,omitempty"`
	InternalBaseURL     string     `json:"internalBaseUrl,omitempty"`
	IsActive            bool       `json:"isActive"`
	TryItEnabled        bool       `json:"tryItEnabled"`
	AllowedMethods      []string   `json:"allowedMethods"`
	AllowedPathPrefixes []string   `json:"allowedPathPrefixes"`
	OwnerTeam           string     `json:"ownerTeam"`
	Tags                []string   `json:"tags"`
	CreatedAt           time.Time  `json:"createdAt"`
	UpdatedAt           time.Time  `json:"updatedAt"`
	LastSpecRefreshAt   *time.Time `json:"lastSpecRefreshAt,omitempty"`
	LastSpecStatus      string     `json:"lastSpecStatus,omitempty"`

	// OwnerGroupID: members of this group manage the API (nil: no owner group).
	OwnerGroupID *int `json:"ownerGroupId"`
	// Try-it header policy: headers users may send besides Content-Type, Accept,
	// Accept-Language and User-Agent. ForwardAllXHeaders keeps the pre-1.5.0
	// behaviour (any X-* header) for APIs registered before.
	AllowedRequestHeaders []string `json:"allowedRequestHeaders"`
	ForwardAllXHeaders    bool     `json:"forwardAllXHeaders"`
	// InjectHeaders are added by the portal upstream; their values are write-only
	// (never returned), InjectHeaderNames lists what is configured.
	InjectHeaders      []HeaderValue `json:"injectHeaders,omitempty"`
	InjectHeaderNames  []string      `json:"injectHeaderNames"`
	RateLimitPerMinute int           `json:"rateLimitPerMinute"`
	TimeoutSeconds     int           `json:"timeoutSeconds"`
}

// HeaderValue is one injected header. On update an empty Value keeps the stored one.
type HeaderValue struct {
	Name  string `json:"name"`
	Value string `json:"value,omitempty"`
}

// APIAccess grants a group view or invoke on one API.
type APIAccess struct {
	GroupID   int    `json:"groupId"`
	GroupName string `json:"groupName,omitempty"`
	Level     string `json:"level"` // view | invoke
}

type APISummary struct {
	ID                int        `json:"id"`
	Name              string     `json:"name"`
	Slug              string     `json:"slug"`
	Description       string     `json:"description"`
	IsActive          bool       `json:"isActive"`
	TryItEnabled      bool       `json:"tryItEnabled"`
	OwnerTeam         string     `json:"ownerTeam"`
	Tags              []string   `json:"tags"`
	LastSpecRefreshAt *time.Time `json:"lastSpecRefreshAt,omitempty"`
	LastSpecStatus    string     `json:"lastSpecStatus,omitempty"`
	CanView           bool       `json:"canView"`
	CanInvoke         bool       `json:"canInvoke"`
	CanManage         bool       `json:"canManage"`
	OwnerGroupID      *int       `json:"ownerGroupId,omitempty"`
}

type APISpecCache struct {
	APIID        int             `json:"apiId"`
	SpecJSON     json.RawMessage `json:"specJson"`
	ETag         string          `json:"etag"`
	FetchedAt    time.Time       `json:"fetchedAt"`
	LastError    string          `json:"lastError"`
	SourceFormat string          `json:"sourceFormat"`
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
	RequestID       string    `json:"requestId"`
	Outcome         string    `json:"outcome"`
	ActorSource     string    `json:"actorSource"`
	Changes         string    `json:"changes"`
}

// AuditFilter selects audit entries; zero values don't filter.
type AuditFilter struct {
	From, To     time.Time
	User         string
	ActionPrefix string
	Outcome      string
	TargetType   string
	TargetID     string
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
