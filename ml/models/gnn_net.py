"""GraphSAGE-style GNN in pure PyTorch (no torch_geometric dependency).

Mean-aggregate neighbour message passing:
    h_v^{k} = sigma( W_self h_v^{k-1} + W_neigh * mean_{u in N(v)} h_u^{k-1} )

Implemented with a sparse adjacency matrix built from edge lists, so
message passing is a single sparse matmul per layer — fast enough on CPU
for the NDSEP compliance graph (~5k nodes, ~25k edges).

Task: node-level binary classification (high-risk organization) on the
compliance graph. CPU-first.
"""

from __future__ import annotations

import json
import os

import torch
import torch.nn as nn

DEVICE = "cpu"


def build_adjacency(num_nodes: int, edges: list[tuple[int, int]],
                    device: str = DEVICE) -> torch.Tensor:
    """Row-normalised sparse adjacency (incl. self-loops handled separately)."""
    idx = torch.tensor(edges, dtype=torch.long).t().contiguous()
    idx = torch.cat([idx, idx.flip(0)], dim=1)  # undirected message passing
    vals = torch.ones(idx.size(1))
    adj = torch.sparse_coo_tensor(idx, vals, (num_nodes, num_nodes))
    deg = torch.sparse.sum(adj, dim=1).to_dense().clamp(min=1.0)
    norm_vals = vals / deg[idx[0]]
    return torch.sparse_coo_tensor(idx, norm_vals,
                                   (num_nodes, num_nodes)).to(device)


class SAGELayer(nn.Module):
    def __init__(self, in_dim: int, out_dim: int):
        super().__init__()
        self.self_lin = nn.Linear(in_dim, out_dim)
        self.neigh_lin = nn.Linear(in_dim, out_dim, bias=False)
        self.norm = nn.LayerNorm(out_dim)

    def forward(self, x: torch.Tensor, adj: torch.Tensor) -> torch.Tensor:
        neigh = torch.sparse.mm(adj, x)
        out = self.self_lin(x) + self.neigh_lin(neigh)
        return torch.relu(self.norm(out))


class GNNNet(nn.Module):
    def __init__(self, input_dim: int = 20, hidden_dim: int = 48,
                 n_layers: int = 2, dropout: float = 0.3):
        super().__init__()
        self.layers = nn.ModuleList()
        dims = [input_dim] + [hidden_dim] * n_layers
        for i in range(n_layers):
            self.layers.append(SAGELayer(dims[i], dims[i + 1]))
        self.dropout = nn.Dropout(dropout)
        self.head = nn.Linear(hidden_dim, 1)
        self.config = {"model": "gnn_net", "input_dim": input_dim,
                       "hidden_dim": hidden_dim, "n_layers": n_layers,
                       "dropout": dropout}

    def forward(self, x: torch.Tensor, adj: torch.Tensor) -> torch.Tensor:
        h = x
        for layer in self.layers:
            h = self.dropout(layer(h, adj))
        return self.head(h).squeeze(-1)  # per-node logits

    # ------------------------------------------------------------------ #
    def save(self, path: str) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        torch.save(self.state_dict(), path)
        with open(path.replace(".pt", "_config.json"), "w") as f:
            json.dump(self.config, f, indent=2)

    @classmethod
    def load(cls, path: str, device: str = DEVICE) -> "GNNNet":
        with open(path.replace(".pt", "_config.json")) as f:
            cfg = json.load(f)
        model = cls(input_dim=cfg["input_dim"], hidden_dim=cfg["hidden_dim"],
                    n_layers=cfg["n_layers"], dropout=cfg["dropout"])
        model.load_state_dict(torch.load(path, map_location=device,
                                         weights_only=True))
        model.to(device).eval()
        return model
