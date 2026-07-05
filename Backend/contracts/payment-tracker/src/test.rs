#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Env, String};

#[test]
fn creates_and_lists_payment() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PaymentTracker);
    let client = PaymentTrackerClient::new(&env, &contract_id);

    let from = Address::generate(&env);
    let to = Address::generate(&env);
    client.create_payment(&from, &to, &100, &String::from_str(&env, "demo"));

    let payments = client.list_payments(&from);
    assert_eq!(payments.len(), 1);
    assert_eq!(payments.first().unwrap().amount, 100);
}
