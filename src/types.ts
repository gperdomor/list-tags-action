export interface DockerHubTagsResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: DockerHubTag[];
}

export interface DockerHubTag {
  creator: number;
  id: number;
  images: DockerHubImage[];
  last_updated: string;
  last_updater: number;
  last_updater_username: string;
  name: string;
  repository: number;
  full_size: number;
  v2: boolean;
  tag_status: string;
  tag_last_pulled: string;
  tag_last_pushed: string;
  media_type: string;
  content_type: string;
  digest: string;
}

export interface DockerHubImage {
  architecture: string;
  features: string;
  variant: string | null;
  digest: string;
  os: string;
  os_features: string;
  os_version: string | null;
  size: number;
  status: string;
  last_pulled: string;
  last_pushed: string;
}

export interface DockerHubAuthResponse {
  token: string;
}

export interface ActionInputs {
  repository: string;
  username?: string;
  password?: string;
  maxResults: number;
  filter?: string;
  ordering?: string;
  name?: string;
}

export interface ActionOutputs {
  tags: string[];
  latestTag: string;
  tagCount: number;
}
