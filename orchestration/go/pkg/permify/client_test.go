package permify

import (
	"context"
	"os"
	"testing"
)

func TestCheckFailsClosedWithoutPermifyURL(t *testing.T) {
	original, existed := os.LookupEnv("PERMIFY_URL")
	_ = os.Unsetenv("PERMIFY_URL")
	defer func() {
		if existed {
			_ = os.Setenv("PERMIFY_URL", original)
		} else {
			_ = os.Unsetenv("PERMIFY_URL")
		}
	}()

	allowed, err := New().Check(context.Background(), CheckRequest{
		SubjectType: "user", SubjectID: "u-1", Permission: "read", ResourceType: "report", ResourceID: "r-1",
	})
	if err == nil || allowed {
		t.Fatalf("expected absent PERMIFY_URL to deny before network transport, got allowed=%v err=%v", allowed, err)
	}
}
