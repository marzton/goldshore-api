export const SUBSCRIPTION_QUERIES = {
  BASE_SELECT: `
    SELECT 
      subscriptions.*,
      features.id as feature_id,
      features.name as feature_name,
      features.description as feature_description
    FROM subscriptions
    LEFT JOIN subscription_features 
      ON subscriptions.id = subscription_features.subscription_id
    LEFT JOIN features 
      ON subscription_features.feature_id = features.id
  `,
  INSERT_SUBSCRIPTION: `INSERT INTO subscriptions (name, description, price) VALUES(?, ?, ?)`,
  INSERT_FEATURE: `INSERT OR IGNORE INTO features(name, description) VALUES(?, ?)`,
  SELECT_FEATURE_ID: `SELECT id FROM features WHERE name = ?`,
  SELECT_FEATURE_IDS: (count) =>
    `SELECT id, name FROM features WHERE name IN (${Array(count).fill("?").join(",")})`,
  INSERT_SUBSCRIPTION_FEATURE: `INSERT INTO subscription_features(subscription_id, feature_id) VALUES(?, ?)`,
};

const processSubscriptionResults = (rows) => {
  const subscriptionsMap = new Map();

  rows.forEach((row) => {
    if (!subscriptionsMap.has(row.id)) {
      const subscription = { ...row, features: [] };
      subscriptionsMap.set(row.id, subscription);
    }

    if (row.feature_id) {
      const subscription = subscriptionsMap.get(row.id);
      subscription.features.push({
        id: row.feature_id,
        name: row.feature_name,
        description: row.feature_description,
      });
    }

    const subscription = subscriptionsMap.get(row.id);
    delete subscription.feature_id;
    delete subscription.feature_name;
    delete subscription.feature_description;
  });

  return Array.from(subscriptionsMap.values());
};

export class SubscriptionService {
  constructor(DB) {
    this.DB = DB;
  }

  async getById(id) {
    const query = `${SUBSCRIPTION_QUERIES.BASE_SELECT} WHERE subscriptions.id = ?`;
    const response = await this.DB.prepare(query).bind(id).all();

    if (response.success) {
      const [subscription] = processSubscriptionResults(response.results);
      return subscription;
    }
    return null;
  }

  async getAll() {
    const query = `${SUBSCRIPTION_QUERIES.BASE_SELECT} ORDER BY subscriptions.id ASC`;
    const response = await this.DB.prepare(query).all();

    if (response.success) {
      return processSubscriptionResults(response.results);
    }
    return [];
  }

  async create(subscriptionData) {
    console.log(subscriptionData);
    const { name, description, price, features } = subscriptionData;

    const subscriptionResponse = await this.DB.prepare(
      SUBSCRIPTION_QUERIES.INSERT_SUBSCRIPTION,
    )
      .bind(name, description, price)
      .run();

    if (!subscriptionResponse.success) {
      throw new Error("Failed to create subscription");
    }

    const subscriptionId = subscriptionResponse.meta.last_row_id;

    if (features?.length) {
      // 1. Insert all features (IGNORE if they already exist)
      const featureInsertStatements = features.map((feature) =>
        this.DB.prepare(SUBSCRIPTION_QUERIES.INSERT_FEATURE).bind(
          feature.name,
          feature.description || null,
        ),
      );

      const insertBatchResults = await this.DB.batch(featureInsertStatements);
      if (insertBatchResults.some((r) => !r.success)) {
        throw new Error("Failed to insert some features");
      }

      // 2. Get IDs for all features
      const featureNames = features.map((f) => f.name);
      const featureIdResponse = await this.DB.prepare(
        SUBSCRIPTION_QUERIES.SELECT_FEATURE_IDS(featureNames.length),
      )
        .bind(...featureNames)
        .all();

      if (!featureIdResponse.success || !featureIdResponse.results.length) {
        throw new Error("Could not retrieve feature IDs");
      }

      const featureMap = new Map(
        featureIdResponse.results.map((f) => [f.name, f.id]),
      );

      // 3. Link features to subscription
      const relationshipStatements = features.map((feature) => {
        const featureId = featureMap.get(feature.name);
        if (!featureId) {
          throw new Error(`Could not get ID for feature: ${feature.name}`);
        }
        return this.DB.prepare(
          SUBSCRIPTION_QUERIES.INSERT_SUBSCRIPTION_FEATURE,
        ).bind(subscriptionId, featureId);
      });

      const relationshipBatchResults = await this.DB.batch(
        relationshipStatements,
      );
      if (relationshipBatchResults.some((r) => !r.success)) {
        throw new Error("Failed to link some features to subscription");
      }
    }

    return { success: true, subscriptionId };
  }
}
