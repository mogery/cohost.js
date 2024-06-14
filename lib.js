const _fetch = require("node-fetch");
const crypto = require("crypto");
const needle = require("needle");
const { decode } = require("./lib/b64arraybuffer");
const fs = require("fs");
const path = require("path");
const mime = require("mime-types");

const API_BASE = "https://cohost.org/api/v1";

/**
 * Fetches an API endpoint.
 *
 * @private
 * @param {string} method HTTP method to use
 * @param {string} endpoint Relative endpoint to fetch
 * @param {string} [cookies] Cookies to send. Used for auth
 * @param {object} [data] Data to send. Query if method is GET, body if method is anything else
 * @param {boolean} [complex=false] Whether to return {headers, body}, or just the body
 * @returns Response, JSON parsed if parsable, string if not
 */
async function fetch(
  method,
  endpoint,
  cookies = "",
  data,
  complex = false,
  headers = {}
) {
  let url =
    API_BASE +
    endpoint +
    (method == "GET" && data ? "?" + new URLSearchParams(data).toString() : "");

  let req = await _fetch(url, {
    method,
    headers: {
      ...(data && data instanceof FormData ? {} : {"Content-Type": "application/json"}),
      Cookie: cookies
    },
    body: method != "GET" && data ? (data instanceof FormData ? data : JSON.stringify(data)) : undefined
  });

  let res = await req.text();
  try {
    res = JSON.parse(res);
  } catch (_) {}

  if (req.status >= 400) {
    throw JSON.stringify(res);
  } else {
    if (complex) {
      return {
        headers: req.headers,
        body: res
      };
    } else {
      return res;
    }
  }
}

/**
 * Represents a cohost User (e.g. john.doe@gmail.com)
 */
class User {
  /**
   * Authenticates the User.
   * This should always be called before using this instance or its references.
   *
   * @param {string} email E-mail address
   * @param {string} password Password
   */
  async login(email, password) {
    const { salt } = await fetch("GET", "/login/salt", undefined, { email });

    const hash = crypto.pbkdf2Sync(
      Buffer.from(password, "utf8"),
      decode(salt),
      200000,
      128,
      "sha384"
    );
    const clientHash = Buffer.from(hash).toString("base64");

    const res = await fetch(
      "POST",
      "/login",
      undefined,
      { email, clientHash },
      true
    );

    this.sessionCookie = res.headers.get("set-cookie").split(";")[0];

    this.userId = res.body.userId;
    this.email = res.body.email;
  }

  /**
   * Get Projects the User has edit permissions on.
   *
   * @returns {Project[]} User's projects
   */
  async getProjects() {
    return (
      await fetch("GET", "/projects/edited", this.sessionCookie)
    ).projects.map(x => new Project(this, x));
  }

  /**
   * Get Notifications of the User. Docs TBD
   */
  async getNotifications(offset = 0, limit = 20) {
    return await fetch("GET", "/notifications/list", this.sessionCookie, {
      offset,
      limit
    });
  }
}

/**
 * Represents a cohost Project (e.g. @mog)
 */
class Project {
  constructor(user, data) {
    this.user = user;
    this.populate(data);
  }

  /**
   * Creates a Project. Docs TBD
   */
  static async create(user, data) {
    return await fetch("POST", "/project", user.sessionCookie, data);
  }

  /**
   * @private
   */
  populate(data) {
    this.id = data.projectId;
    this.handle = data.handle;
    this.displayName = data.displayName;
    this.dek = data.dek;
    this.description = data.description;
    this.avatarURL = data.avatarURL;
    this.headerURL = data.headerURL;
    this.privacy = data.privacy;
    this.pronouns = data.pronouns;
    this.url = data.url;
    this.flags = data.flags;
    this.avatarShape = data.avatarShape;
  }

  /**
   * @param {number} [page=0] Page of posts to get, 20 posts per page
   * @returns {object[]}
   */
  async getPosts(page = 0) {
    let res = await fetch(
      "GET",
      `/project/${encodeURIComponent(
        this.handle
      )}/posts?page=${encodeURIComponent(page.toString())}`,
      this.user.sessionCookie
    );

    return res.items.map(x => new Post(this.user, x));
  }

  async uploadAttachment(postId, filename) {
    const fileContentType = mime.lookup(filename);
    const fileContentLength = fs.statSync(filename).size;
    const S3Parameters = await fetch(
      "POST",
      `/project/${encodeURIComponent(
        this.handle
      )}/posts/${postId}/attach/start`,
      this.user.sessionCookie,
      {
        filename: path.basename(filename),
        content_type: fileContentType,
        content_length: fileContentLength
      }
    );

    await needle(
      "post",
      S3Parameters.url,
      {
        ...S3Parameters.requiredFields,
        file: {
          file: filename,
          content_type: fileContentType
        }
      },
      { multipart: true }
    );

    const res = fetch(
      "POST",
      `/project/${encodeURIComponent(
        this.handle
      )}/posts/${postId}/attach/finish/${S3Parameters.attachmentId}`,
      this.user.sessionCookie
    );

    return await res;
  }
}

/**
 * Represents a cohost Post
 */
class Post {
  constructor(user, data) {
    this.user = user;
    this.populate(data);
  }

  /**
   * @typedef {Object} PostMarkdownBlock
   * @property {string} content
   */

  /**
   * @typedef {Object} PostAttachmentBlock
   * @property {string} fileURL
   * @property {string} attachmentId
   * @property {string} altText
   */

  /**
   * @typedef {Object} PostBlock
   * @property {string} type Type of block. Currently available: 'markdown' and 'attachment'
   * @property {PostMarkdownBlock} [markdown] Should only be present if type is 'markdown'
   * @property {PostAttachmentBlock} [attachment] Should only be present if type is 'attachment'
   */

  /**
   * @typedef {Object} PostCreate
   * @property {number} postState 1 for published, 0 for draft
   * @property {string} headline Headline
   * @property {boolean} adultContent Does the post contain adult content?
   * @property {PostBlock[]} blocks Blocks (docs TBD)
   * @property {string[]} cws Content Warnings
   * @property {string[]} tags Tags (docs TBD)
   */

  /**
   *
   * @param {Project} project Project to post to
   * @param {PostCreate} data
   * @returns
   */
  static async create(project, data) {
    let { postId } = await fetch(
      "POST",
      `/project/${encodeURIComponent(project.handle)}/posts`,
      project.user.sessionCookie,
      data
    );

    return postId;
  }

  /**
   *
   * @param {Project} project Project to post to
   * @param {string} postId ID of the post to update
   * @param {PostCreate} data
   */
  static async update(project, postId, data) {
    await fetch(
      "PUT",
      `/project/${encodeURIComponent(project.handle)}/posts/${postId}`,
      project.user.sessionCookie,
      data
    );

    return postId;
  }

  // Endpoint is disabled;
  // static async getById(project, id) {
  //     let data = await fetch(
  //         "GET",
  //         `/project_posts/${id}`,
  //         project.user.sessionCookie
  //     );

  //     return new Post(user, data);
  // }

  /**
   * @private
   */
  populate(data) {
    this.id = data.postId;
    this.headline = data.headline;
    this.publishedAt = new Date(data.publishedAt);
    this.filename = data.filename;
    this.transparentShareOfPostId = data.transparentShareOfPostId;
    this.state = data.state;
    this.numComments = data.numComments;
    this.numSharedComments = data.numSharedComments;
    this.cws = data.cws;
    this.tags = data.tags;
    this.blocks = data.blocks;
    this.plainTextBody = data.plainTextBody;
    this.project = new Project(this.user, data.postingProject);
    this.shareTree = data.shareTree;
    this.relatedProjects = data.relatedProjects;
    this.effectiveAdultContent = data.effectiveAdultContent;
    this.isEditor = data.isEditor;
    this.contributorBlockIncomingOrOutgoing =
      data.contributorBlockIncomingOrOutgoing;
    this.hasAnyContributorMuted = data.hasAnyContributorMuted;
    this.isLiked = data.isLiked;
    this.canShare = data.canShare;
    this.canPublish = data.canPublish;
    this.singlePostPageUrl = data.singlePostPageUrl;
    this.renderInIframe = data.renderInIframe;
    this.postPreviewIFrameUrl = data.postPreviewIFrameUrl;
    this.postEditUrl = data.postEditUrl;
  }
}

module.exports = {
  User,
  Project,
  Post
};
