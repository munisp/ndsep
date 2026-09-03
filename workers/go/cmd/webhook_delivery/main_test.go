package main

import "testing"

func TestValidateWebhookTarget(t *testing.T) {
	testCases := []struct {
		name                 string
		rawURL               string
		allowLocalTestTarget bool
		wantErr              bool
	}{
		{name: "permits public HTTPS hostname", rawURL: "https://receiver.example.test/webhooks", wantErr: false},
		{name: "rejects plaintext public target", rawURL: "http://receiver.example.test/webhooks", wantErr: true},
		{name: "rejects private literal target", rawURL: "https://10.0.0.8/webhooks", wantErr: true},
		{name: "rejects loopback literal target", rawURL: "https://127.0.0.1/webhooks", wantErr: true},
		{name: "rejects IPv4-mapped IPv6 loopback target", rawURL: "https://[::ffff:127.0.0.1]/webhooks", wantErr: true},
		{name: "rejects carrier-grade NAT target", rawURL: "https://100.64.0.1/webhooks", wantErr: true},
		{name: "rejects benchmarking target", rawURL: "https://198.18.0.1/webhooks", wantErr: true},
		{name: "rejects localhost hostname", rawURL: "https://localhost/webhooks", wantErr: true},
		{name: "rejects embedded credentials", rawURL: "https://user:password@receiver.example.test/webhooks", wantErr: true},
		{name: "allows only explicit local loopback test double", rawURL: "http://127.0.0.1:8181/webhooks", allowLocalTestTarget: true, wantErr: false},
		{name: "does not allow local hostname test double", rawURL: "http://localhost:8181/webhooks", allowLocalTestTarget: true, wantErr: true},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := validateWebhookTarget(testCase.rawURL, testCase.allowLocalTestTarget)
			if (err != nil) != testCase.wantErr {
				t.Fatalf("validateWebhookTarget(%q, %t) error=%v wantErr=%t", testCase.rawURL, testCase.allowLocalTestTarget, err, testCase.wantErr)
			}
		})
	}
}
