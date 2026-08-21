// GENERATED CODE - DO NOT MODIFY BY HAND
// Run: dart run build_runner build

part of 'organization.dart';

Organization _$OrganizationFromJson(Map<String, dynamic> json) => Organization(
  id: (json['id'] as num).toInt(),
  name: json['name'] as String,
  registrationNumber: json['registration_number'] as String,
  sector: json['sector'] as String,
  country: json['country'] as String,
  city: json['city'] as String,
  latitude: (json['latitude'] as num?)?.toDouble(),
  longitude: (json['longitude'] as num?)?.toDouble(),
  complianceScore: (json['compliance_score'] as num).toDouble(),
  complianceStatus: json['compliance_status'] as String,
  riskScore: (json['risk_score'] as num).toDouble(),
  agentInstalled: json['agent_installed'] as bool,
);

Map<String, dynamic> _$OrganizationToJson(Organization instance) => <String, dynamic>{
  'id': instance.id,
  'name': instance.name,
  'registration_number': instance.registrationNumber,
  'sector': instance.sector,
  'country': instance.country,
  'city': instance.city,
  'latitude': instance.latitude,
  'longitude': instance.longitude,
  'compliance_score': instance.complianceScore,
  'compliance_status': instance.complianceStatus,
  'risk_score': instance.riskScore,
  'agent_installed': instance.agentInstalled,
};
