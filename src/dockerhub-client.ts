import * as core from '@actions/core';
import { HttpClient } from '@actions/http-client';
import type { ActionInputs, DockerHubAuthResponse, DockerHubTag, DockerHubTagsResponse } from './types.js';

export class DockerHubClient {
  private client: HttpClient;
  private token?: string;

  constructor() {
    this.client = new HttpClient('fetch-dockerhub-tags-action');
  }

  /**
   * Authenticate with Docker Hub
   */
  async authenticate(username: string, password: string): Promise<void> {
    try {
      core.info('Authenticating with Docker Hub...');

      const response = await this.client.post(
        'https://hub.docker.com/v2/users/login/',
        JSON.stringify({ username, password }),
        {
          'Content-Type': 'application/json',
        },
      );

      const body = await response.readBody();
      const authResponse: DockerHubAuthResponse = JSON.parse(body);

      if (authResponse.token) {
        this.token = authResponse.token;
        core.info('✓ Authentication successful');
      } else {
        core.warning('⚠ Authentication failed, proceeding without authentication');
      }
    } catch (error) {
      core.warning(`⚠ Authentication failed: ${error}, proceeding without authentication`);
    }
  }

  /**
   * Fetch tags from Docker Hub repository with pagination support
   */
  async fetchTags(inputs: ActionInputs): Promise<DockerHubTag[]> {
    const apiUrl = this.buildApiUrl(inputs.repository);
    core.info(`Fetching from: ${apiUrl}`);

    try {
      const headers: Record<string, string> = {};
      if (this.token) {
        headers['Authorization'] = `Bearer ${this.token}`;
      }

      let allTags: DockerHubTag[] = [];
      let nextUrl: string | null = `${apiUrl}?page_size=100`;

      if (inputs.ordering) {
        nextUrl += `&ordering=${inputs.ordering}`;
      }

      if (inputs.name) {
        nextUrl += `&name=${inputs.name}`;
      }

      let remainingResults = inputs.maxResults;

      while (nextUrl && allTags.length < inputs.maxResults) {
        core.debug(`Fetching page: ${nextUrl}`);

        const response = await this.client.get(nextUrl, headers);

        if (response.message.statusCode !== 200) {
          throw new Error(`HTTP ${response.message.statusCode}: ${response.message.statusMessage}`);
        }

        const body = await response.readBody();
        const tagsResponse: DockerHubTagsResponse = JSON.parse(body);

        if (!tagsResponse.results) {
          throw new Error('Invalid response from Docker Hub API');
        }

        // Add tags up to the max results limit
        const tagsToAdd = tagsResponse.results.slice(0, remainingResults);
        allTags = allTags.concat(tagsToAdd);
        remainingResults -= tagsToAdd.length;

        // Check if there's a next page and we need more results
        nextUrl = tagsResponse.next || null;

        if (allTags.length >= inputs.maxResults) {
          core.info(`Reached maximum results limit: ${inputs.maxResults}`);
          break;
        }
      }

      core.info(`✓ Fetched ${allTags.length} tags`);
      return allTags;
    } catch (error) {
      throw new Error(`Failed to fetch tags: ${error}`);
    }
  }

  /**
   * Build API URL based on repository name
   */
  private buildApiUrl(repository: string): string {
    // Check if it's an official image (no slash) or user/org image
    if (!repository.includes('/')) {
      // Official image
      return `https://hub.docker.com/v2/repositories/library/${repository}/tags`;
    } else {
      // User or organization image
      return `https://hub.docker.com/v2/repositories/${repository}/tags`;
    }
  }
}
