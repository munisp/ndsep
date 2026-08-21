use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use chrono::{DateTime, Utc};
use dashmap::DashMap;
use log::info;
use parking_lot::RwLock;

use crate::models::packet::CapturedPacket;

/// Statistical anomaly detector using Z-score analysis and adaptive baseline.
/// Replaces Python's scikit-learn SGDOneClassSVM with a pure-Rust implementation
/// that can process 100K+ packets/sec.
#[derive(Clone)]
pub struct AnomalyDetector {
    // Per-source-IP traffic profiles
    ip_profiles: Arc<DashMap<IpAddr, TrafficProfile>>,
    // Global feature statistics for Z-score computation
    global_stats: Arc<RwLock<FeatureStats>>,
    // Isolation forest state (simplified)
    forest: Arc<RwLock<IsolationForest>>,
    // Counters
    total_analyzed: Arc<AtomicU64>,
    anomalies_found: Arc<AtomicU64>,
    // Configurable thresholds
    pub z_score_threshold: f64,
    pub isolation_threshold: f64,
    pub min_training_samples: usize,
}

#[derive(Debug, Clone)]
struct TrafficProfile {
    packets_per_window: Vec<u64>,
    bytes_per_window: Vec<u64>,
    unique_ports: Vec<u16>,
    protocol_distribution: HashMap<String, u64>,
    last_seen: DateTime<Utc>,
    total_packets: u64,
    avg_packet_size: f64,
    port_entropy: f64,
}

#[derive(Debug, Clone)]
struct FeatureStats {
    // Rolling mean and variance for each feature dimension
    means: Vec<f64>,
    variances: Vec<f64>,
    count: u64,
    // Feature names for interpretability
    feature_names: Vec<String>,
}

impl FeatureStats {
    fn new() -> Self {
        let feature_names = vec![
            "packet_rate".into(),
            "byte_rate".into(),
            "avg_packet_size".into(),
            "port_entropy".into(),
            "unique_dst_ports".into(),
            "tcp_syn_ratio".into(),
            "small_packet_ratio".into(),
            "large_packet_ratio".into(),
        ];
        let n = feature_names.len();
        Self {
            means: vec![0.0; n],
            variances: vec![1.0; n],
            count: 0,
            feature_names,
        }
    }

    fn update(&mut self, features: &[f64]) {
        self.count += 1;
        let n = self.count as f64;
        for (i, &val) in features.iter().enumerate() {
            if i >= self.means.len() {
                break;
            }
            let old_mean = self.means[i];
            self.means[i] += (val - old_mean) / n;
            self.variances[i] += (val - old_mean) * (val - self.means[i]);
        }
    }

    fn z_scores(&self, features: &[f64]) -> Vec<f64> {
        features
            .iter()
            .enumerate()
            .map(|(i, &val)| {
                if i >= self.means.len() || self.count < 2 {
                    return 0.0;
                }
                let std_dev = (self.variances[i] / (self.count as f64).max(1.0)).sqrt();
                if std_dev < 1e-10 {
                    0.0
                } else {
                    (val - self.means[i]) / std_dev
                }
            })
            .collect()
    }
}

/// Simplified Isolation Forest implementation in pure Rust.
/// Uses random hyperplanes for anomaly scoring.
#[derive(Debug, Clone)]
struct IsolationForest {
    trees: Vec<IsolationTree>,
    n_estimators: usize,
    max_samples: usize,
    trained: bool,
}

#[derive(Debug, Clone)]
enum IsolationTree {
    Leaf {
        size: usize,
    },
    Branch {
        split_feature: usize,
        split_value: f64,
        left: Box<IsolationTree>,
        right: Box<IsolationTree>,
    },
}

impl IsolationForest {
    fn new(n_estimators: usize, max_samples: usize) -> Self {
        Self {
            trees: Vec::new(),
            n_estimators,
            max_samples,
            trained: false,
        }
    }

    fn fit(&mut self, data: &[Vec<f64>]) {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        let n_features = if data.is_empty() { 8 } else { data[0].len() };
        let max_depth = (self.max_samples as f64).log2().ceil() as usize;

        self.trees.clear();
        for _ in 0..self.n_estimators {
            let sample_size = self.max_samples.min(data.len());
            let mut indices: Vec<usize> = (0..data.len()).collect();
            for i in (1..indices.len()).rev() {
                let j = rng.gen_range(0..=i);
                indices.swap(i, j);
            }
            let sample: Vec<&Vec<f64>> = indices[..sample_size].iter().map(|&i| &data[i]).collect();
            let tree = Self::build_tree(&sample, 0, max_depth, n_features, &mut rng);
            self.trees.push(tree);
        }
        self.trained = true;
    }

    fn build_tree(
        data: &[&Vec<f64>],
        depth: usize,
        max_depth: usize,
        n_features: usize,
        rng: &mut impl rand::Rng,
    ) -> IsolationTree {
        if depth >= max_depth || data.len() <= 1 {
            return IsolationTree::Leaf { size: data.len() };
        }

        let feature = rng.gen_range(0..n_features);
        let values: Vec<f64> = data
            .iter()
            .filter_map(|d| d.get(feature).copied())
            .collect();
        if values.is_empty() {
            return IsolationTree::Leaf { size: data.len() };
        }

        let min_val = values.iter().cloned().fold(f64::INFINITY, f64::min);
        let max_val = values.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        if (max_val - min_val).abs() < 1e-10 {
            return IsolationTree::Leaf { size: data.len() };
        }

        let split_value = rng.gen_range(min_val..max_val);

        let (left_data, right_data): (Vec<&Vec<f64>>, Vec<&Vec<f64>>) = data
            .iter()
            .partition(|d| d.get(feature).copied().unwrap_or(0.0) < split_value);

        if left_data.is_empty() || right_data.is_empty() {
            return IsolationTree::Leaf { size: data.len() };
        }

        IsolationTree::Branch {
            split_feature: feature,
            split_value,
            left: Box::new(Self::build_tree(
                &left_data,
                depth + 1,
                max_depth,
                n_features,
                rng,
            )),
            right: Box::new(Self::build_tree(
                &right_data,
                depth + 1,
                max_depth,
                n_features,
                rng,
            )),
        }
    }

    fn score(&self, point: &[f64]) -> f64 {
        if !self.trained || self.trees.is_empty() {
            return 0.5;
        }

        let avg_depth: f64 = self
            .trees
            .iter()
            .map(|tree| Self::path_length(tree, point, 0) as f64)
            .sum::<f64>()
            / self.trees.len() as f64;

        let n = self.max_samples as f64;
        let c_n = if n > 2.0 {
            2.0 * (n.ln() + 0.5772156649) - 2.0 * (n - 1.0) / n
        } else {
            1.0
        };

        // Anomaly score: closer to 1.0 = more anomalous
        2.0_f64.powf(-avg_depth / c_n)
    }

    fn path_length(tree: &IsolationTree, point: &[f64], depth: usize) -> usize {
        match tree {
            IsolationTree::Leaf { size } => {
                depth
                    + if *size > 2 {
                        let n = *size as f64;
                        (2.0 * (n.ln() + 0.5772156649) - 2.0 * (n - 1.0) / n) as usize
                    } else if *size == 2 {
                        1
                    } else {
                        0
                    }
            }
            IsolationTree::Branch {
                split_feature,
                split_value,
                left,
                right,
            } => {
                let val = point.get(*split_feature).copied().unwrap_or(0.0);
                if val < *split_value {
                    Self::path_length(left, point, depth + 1)
                } else {
                    Self::path_length(right, point, depth + 1)
                }
            }
        }
    }
}

impl AnomalyDetector {
    pub fn new() -> Self {
        Self {
            ip_profiles: Arc::new(DashMap::new()),
            global_stats: Arc::new(RwLock::new(FeatureStats::new())),
            forest: Arc::new(RwLock::new(IsolationForest::new(100, 256))),
            total_analyzed: Arc::new(AtomicU64::new(0)),
            anomalies_found: Arc::new(AtomicU64::new(0)),
            z_score_threshold: 3.0,
            isolation_threshold: 0.65,
            min_training_samples: 100,
        }
    }

    pub fn extract_features(&self, packet: &CapturedPacket) -> Vec<f64> {
        let size = packet.length as f64;
        let is_syn = packet
            .flags
            .map(|f| if f.syn && !f.ack { 1.0 } else { 0.0 })
            .unwrap_or(0.0);
        let is_small = if size < 64.0 { 1.0 } else { 0.0 };
        let is_large = if size > 1400.0 { 1.0 } else { 0.0 };
        let port_val = packet.dst_port.unwrap_or(0) as f64;
        let ttl = packet.ttl.unwrap_or(64) as f64;

        vec![
            size,        // packet_size
            port_val,    // dst_port_normalized
            is_syn,      // tcp_syn_ratio
            is_small,    // small_packet_ratio
            is_large,    // large_packet_ratio
            ttl / 255.0, // normalized_ttl
            if packet.dns_query.is_some() { 1.0 } else { 0.0 },
            if packet.http_method.is_some() {
                1.0
            } else {
                0.0
            },
        ]
    }

    pub fn analyze(&self, packet: &CapturedPacket) -> AnomalyResult {
        self.total_analyzed.fetch_add(1, Ordering::Relaxed);

        let features = self.extract_features(packet);

        // Update rolling statistics
        {
            let mut stats = self.global_stats.write();
            stats.update(&features);
        }

        let z_scores = {
            let stats = self.global_stats.read();
            stats.z_scores(&features)
        };

        let max_z = z_scores.iter().cloned().fold(0.0_f64, f64::max);

        // Isolation forest score
        let iso_score = {
            let forest = self.forest.read();
            forest.score(&features)
        };

        // Combined anomaly score (0-100)
        let z_component = (max_z / self.z_score_threshold).min(1.0) * 50.0;
        let iso_component = iso_score * 50.0;
        let combined_score = z_component + iso_component;

        let is_anomalous = max_z > self.z_score_threshold || iso_score > self.isolation_threshold;

        if is_anomalous {
            self.anomalies_found.fetch_add(1, Ordering::Relaxed);
        }

        // Determine anomaly type
        let anomaly_type = if is_anomalous {
            let stats = self.global_stats.read();
            let mut explanations = Vec::new();
            for (i, &z) in z_scores.iter().enumerate() {
                if z.abs() > self.z_score_threshold {
                    if let Some(name) = stats.feature_names.get(i) {
                        explanations.push(format!("{}: z={:.2}", name, z));
                    }
                }
            }
            Some(explanations.join(", "))
        } else {
            None
        };

        AnomalyResult {
            is_anomalous,
            score: combined_score,
            z_score_max: max_z,
            isolation_score: iso_score,
            anomaly_type,
            feature_scores: z_scores,
        }
    }

    pub fn train_on_batch(&self, packets: &[CapturedPacket]) {
        let data: Vec<Vec<f64>> = packets.iter().map(|p| self.extract_features(p)).collect();
        if data.len() >= self.min_training_samples {
            let mut forest = self.forest.write();
            forest.fit(&data);
            info!("Isolation forest trained on {} samples", data.len());
        }
    }

    pub fn stats(&self) -> AnomalyStats {
        let stats = self.global_stats.read();
        AnomalyStats {
            total_analyzed: self.total_analyzed.load(Ordering::Relaxed),
            anomalies_found: self.anomalies_found.load(Ordering::Relaxed),
            model_trained: self.forest.read().trained,
            training_samples: stats.count,
            z_score_threshold: self.z_score_threshold,
            isolation_threshold: self.isolation_threshold,
            profiles_tracked: self.ip_profiles.len(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnomalyResult {
    pub is_anomalous: bool,
    pub score: f64,
    pub z_score_max: f64,
    pub isolation_score: f64,
    pub anomaly_type: Option<String>,
    pub feature_scores: Vec<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnomalyStats {
    pub total_analyzed: u64,
    pub anomalies_found: u64,
    pub model_trained: bool,
    pub training_samples: u64,
    pub z_score_threshold: f64,
    pub isolation_threshold: f64,
    pub profiles_tracked: usize,
}

use serde::{Deserialize, Serialize};
