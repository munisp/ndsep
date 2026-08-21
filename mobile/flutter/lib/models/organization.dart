import 'package:json_annotation/json_annotation.dart';

part 'organization.g.dart';

@JsonSerializable()
class Organization {
  final int id;
  final String name;
  @JsonKey(name: 'registration_number')
  final String registrationNumber;
  final String sector;
  final String country;
  final String city;
  final double? latitude;
  final double? longitude;
  @JsonKey(name: 'compliance_score')
  final double complianceScore;
  @JsonKey(name: 'compliance_status')
  final String complianceStatus;
  @JsonKey(name: 'risk_score')
  final double riskScore;
  @JsonKey(name: 'agent_installed')
  final bool agentInstalled;

  const Organization({
    required this.id,
    required this.name,
    required this.registrationNumber,
    required this.sector,
    required this.country,
    required this.city,
    this.latitude,
    this.longitude,
    required this.complianceScore,
    required this.complianceStatus,
    required this.riskScore,
    required this.agentInstalled,
  });

  factory Organization.fromJson(Map<String, dynamic> json) =>
      _$OrganizationFromJson(json);
  Map<String, dynamic> toJson() => _$OrganizationToJson(this);
}
