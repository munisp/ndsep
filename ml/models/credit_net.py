"""CreditNet — credit / compliance default-risk scorer (MLP).

Fills the "credit scoring does not exist" gap in the NDSEP platform.
Input: per-organization credit/compliance features (see
ml.data.generate_synthetic.CREDIT_FEATURES). Output: default-probability
logit over a 24-month horizon. CPU-first.
"""

from __future__ import annotations

import json
import os

import torch
import torch.nn as nn

DEVICE = "cpu"


class CreditNet(nn.Module):
    def __init__(self, input_dim: int = 10, hidden_dims=(64, 32),
                 dropout: float = 0.2):
        super().__init__()
        layers, prev = [], input_dim
        for h in hidden_dims:
            layers += [nn.Linear(prev, h), nn.BatchNorm1d(h), nn.ReLU(),
                       nn.Dropout(dropout)]
            prev = h
        layers.append(nn.Linear(prev, 1))
        self.net = nn.Sequential(*layers)
        self.config = {"model": "credit_net", "input_dim": input_dim,
                       "hidden_dims": list(hidden_dims), "dropout": dropout}

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x).squeeze(-1)  # logits

    # ------------------------------------------------------------------ #
    def save(self, path: str) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        torch.save(self.state_dict(), path)
        with open(path.replace(".pt", "_config.json"), "w") as f:
            json.dump(self.config, f, indent=2)

    @classmethod
    def load(cls, path: str, device: str = DEVICE) -> "CreditNet":
        with open(path.replace(".pt", "_config.json")) as f:
            cfg = json.load(f)
        model = cls(input_dim=cfg["input_dim"],
                    hidden_dims=tuple(cfg["hidden_dims"]),
                    dropout=cfg["dropout"])
        model.load_state_dict(torch.load(path, map_location=device,
                                         weights_only=True))
        model.to(device).eval()
        return model
