package permify

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

type CheckRequest struct {
	SubjectType  string `json:"subject_type"`
	SubjectID    string `json:"subject_id"`
	Permission   string `json:"permission"`
	ResourceType string `json:"resource_type"`
	ResourceID   string `json:"resource_id"`
}

type CheckResponse struct {
	Allowed bool   `json:"allowed"`
	Reason  string `json:"reason,omitempty"`
}

type Client struct {
	baseURL    string
	httpClient *http.Client
	logger     *log.Logger
}

func New() *Client {
	return &Client{
		baseURL:    strings.TrimRight(strings.TrimSpace(os.Getenv("PERMIFY_URL")), "/"),
		httpClient: &http.Client{Timeout: 3 * time.Second},
		logger:     log.New(os.Stdout, "[permify] ", log.LstdFlags),
	}
}

// Check delegates every authorization decision to Permify. Any dependency,
// protocol, or decoding failure is an explicit error; callers must deny.
func (c *Client) Check(ctx context.Context, req CheckRequest) (bool, error) {
	if c.baseURL == "" {
		return false, fmt.Errorf("PERMIFY_URL is required for authorization decisions")
	}
	body, err := json.Marshal(req)
	if err != nil {
		return false, fmt.Errorf("marshal Permify authorization request: %w", err)
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/v1/permissions/check", c.baseURL), strings.NewReader(string(body)))
	if err != nil {
		return false, fmt.Errorf("build Permify authorization request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return false, fmt.Errorf("Permify authorization service unavailable: %w", err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return false, fmt.Errorf("read Permify authorization response: %w", err)
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return false, fmt.Errorf("Permify authorization response HTTP %d: %s", resp.StatusCode, string(respBody))
	}
	var checkResp CheckResponse
	if err := json.Unmarshal(respBody, &checkResp); err != nil {
		return false, fmt.Errorf("decode Permify authorization response: %w", err)
	}
	return checkResp.Allowed, nil
}

func (c *Client) HasPermission(ctx context.Context, role, permission string) (bool, error) {
	return c.Check(ctx, CheckRequest{
		SubjectType: role, SubjectID: "*", Permission: permission,
		ResourceType: "platform", ResourceID: "ndsep",
	})
}
